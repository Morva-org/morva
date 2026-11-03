// Step 1 spike: can a merchant's passkey (WebAuthn, P-256) control a NEAR Intents account?
// Throwaway research code, like scripts/payment-spike.mjs. Not product code.
//
// Emulates a platform passkey with Node's P-256 implementation, builds WebAuthn assertions the
// way a browser does, and runs them through `simulate_intents` on the production Verifier
// (intents.near). simulate_intents is a free view call: nothing is executed or stored, and no
// funds or NEAR account are needed.
//
// Usage: node scripts/passkey-account-spike.mjs
import { createHash, generateKeyPairSync, randomBytes, sign as ecdsaSign } from "node:crypto";
import { keccak256 } from "viem";
import { base58 } from "./payment-spike.mjs";

const RPC = process.env.NEAR_RPC_URL || "https://rpc.mainnet.fastnear.com";
const VERIFIER = "intents.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ORIGIN = "https://morva.example";
const RP_ID = "morva.example";

const sha256 = data => createHash("sha256").update(data).digest();
const b64url = buf => Buffer.from(buf).toString("base64url");

// --- base58 decode, to check the source's test vector -------------------------------------
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const hex = n.toString(16).padStart(128, "0");
  return Buffer.from(hex, "hex");
}

// --- account model ------------------------------------------------------------------------
/** The Verifier's implicit account for a P-256 key: "0x" + hex(keccak256("p256" || pk)[12..32]). */
function p256AccountId(rawPk64) {
  const digest = keccak256(Buffer.concat([Buffer.from("p256"), rawPk64]));
  return `0x${digest.slice(2 + 24)}`;
}

/** A software stand-in for a platform passkey: an ES256 key pair. */
function newPasskey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { privateKey, raw, publicKey: `p256:${base58(raw)}`, accountId: p256AccountId(raw) };
}

/** Signs `payload` the way navigator.credentials.get() does when the challenge is sha256(payload). */
// P-256 group order. Authenticators return either of the two valid S values; the Verifier only
// accepts the low one, so the client must normalise before submitting.
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
function toLowS(sig) {
  const s = BigInt(`0x${sig.subarray(32).toString("hex")}`);
  if (s <= P256_N / 2n) return sig;
  return Buffer.concat([sig.subarray(0, 32), Buffer.from((P256_N - s).toString(16).padStart(64, "0"), "hex")]);
}

function webauthnSign(passkey, payload, { flags = 0x05, signCount = 1, normalizeS = true } = {}) {
  const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([flags]), Buffer.from([0, 0, 0, signCount])]);
  const clientDataJson = JSON.stringify({ type: "webauthn.get", challenge: b64url(sha256(payload)), origin: ORIGIN, crossOrigin: false });
  const message = Buffer.concat([authenticatorData, sha256(clientDataJson)]);
  const raw = ecdsaSign("sha256", message, { key: passkey.privateKey, dsaEncoding: "ieee-p1363" });
  const signature = normalizeS ? toLowS(raw) : raw;
  return {
    standard: "webauthn",
    payload,
    public_key: passkey.publicKey,
    signature: `p256:${base58(signature)}`,
    client_data_json: clientDataJson,
    authenticator_data: b64url(authenticatorData),
  };
}

// --- Verifier calls -----------------------------------------------------------------------
async function view(method, args) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "spike",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: VERIFIER,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const json = await res.json();
  const error = json.error?.data ?? json.error ?? json.result?.error;
  if (error) return { error: String(typeof error === "string" ? error : JSON.stringify(error)) };
  return { value: JSON.parse(Buffer.from(json.result.result).toString()) };
}

/** Nonce: magic 5628f6c6 | version 0 | 4-byte salt | deadline u64 ns LE | 15 random bytes. */
function nonce(saltHex, deadline) {
  const ns = Buffer.alloc(8);
  ns.writeBigUInt64LE(BigInt(deadline.getTime()) * 1_000_000n);
  return Buffer.concat([Buffer.from("5628f6c6", "hex"), Buffer.from([0]), Buffer.from(saltHex, "hex"), ns, randomBytes(15)]).toString("base64");
}

function payload(signerId, salt, intents) {
  const deadline = new Date(Date.now() + 5 * 60_000);
  return JSON.stringify({ signer_id: signerId, verifying_contract: VERIFIER, deadline: deadline.toISOString(), nonce: nonce(salt, deadline), intents });
}

const shorten = s => (s.length > 220 ? `${s.slice(0, 220)}…` : s);

// --- the checks ---------------------------------------------------------------------------
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

// 1. Our derivation matches the Verifier source's own test vector.
const vectorPk = "3aMVMxsoAnHUbweXMtdKaN1uJaNwsfKv7wnc97SDGjXhyK62VyJwhPUPLZefKVthcoUcuWK6cqkSU4M542ipNxS3";
const derived = p256AccountId(base58Decode(vectorPk));
check("P-256 implicit account derivation matches intents source vector", derived === "0x7edf07ede58238026db3f90fc8032633b69b8de5", `p256:${vectorPk.slice(0, 12)}… -> ${derived}`);

const salt = (await view("current_salt", {})).value;
console.log(`      current salt: ${salt}`);

const main = newPasskey();
const backup = newPasskey();
console.log(`      merchant passkey: ${main.publicKey.slice(0, 24)}…  account: ${main.accountId}`);

// 2. The Verifier already treats the passkey's own key as registered for its implicit account.
const has = await view("has_public_key", { account_id: main.accountId, public_key: main.publicKey });
check("Verifier recognises the passkey key for its implicit account (no registration, no tx)", has.value === true, `has_public_key -> ${JSON.stringify(has.value ?? has.error)}`);

// 3. The passkey adds a second passkey (backup device) by signed intent.
{
  const signed = webauthnSign(main, payload(main.accountId, salt, [{ intent: "add_public_key", public_key: backup.publicKey }]));
  const r = await view("simulate_intents", { signed: [signed] });
  const events = r.value?.logs?.join(" ") ?? "";
  check("Passkey-signed add_public_key (backup device) simulates", !r.error && events.includes("public_key_added"), shorten(r.error ?? events));
}

// 4. A withdrawal signed by the passkey passes signature checks and fails only on balance.
{
  const signed = webauthnSign(main, payload(main.accountId, salt, [{ intent: "ft_withdraw", token: USDC, receiver_id: "morva-spike.near", amount: "1" }]));
  const r = await view("simulate_intents", { signed: [signed] });
  const balanceError = /balance|overflow|insufficient/i.test(r.error ?? "");
  check("Passkey-signed ft_withdraw is accepted up to the balance check (account is empty)", balanceError, shorten(r.error ?? JSON.stringify(r.value)));
}

// 5. A transfer to another account, same expectation.
{
  const signed = webauthnSign(main, payload(main.accountId, salt, [{ intent: "transfer", receiver_id: backup.accountId, tokens: { [`nep141:${USDC}`]: "1" } }]));
  const r = await view("simulate_intents", { signed: [signed] });
  check("Passkey-signed transfer is accepted up to the balance check", /balance|overflow|insufficient/i.test(r.error ?? ""), shorten(r.error ?? JSON.stringify(r.value)));
}

// 6. Negative controls: a tampered payload and a key that isn't registered are both rejected.
{
  const p = payload(main.accountId, salt, [{ intent: "add_public_key", public_key: backup.publicKey }]);
  const signed = webauthnSign(main, p);
  signed.payload = p.replace(backup.publicKey, main.publicKey);
  const r = await view("simulate_intents", { signed: [signed] });
  check("Tampered payload is rejected", Boolean(r.error), shorten(r.error ?? "accepted (unexpected)"));

  const stranger = newPasskey();
  const forged = webauthnSign(stranger, payload(main.accountId, salt, [{ intent: "add_public_key", public_key: stranger.publicKey }]));
  const r2 = await view("simulate_intents", { signed: [forged] });
  check("A different passkey cannot sign for the merchant's account", Boolean(r2.error), shorten(r2.error ?? "accepted (unexpected)"));
}

// 7. User verification: is the UV flag enforced on-chain, or must Morva require it in the browser?
{
  const signed = webauthnSign(main, payload(main.accountId, salt, [{ intent: "add_public_key", public_key: backup.publicKey }]), { flags: 0x01 });
  const r = await view("simulate_intents", { signed: [signed] });
  console.log(`INFO  Assertion with UP only (no UV): ${r.error ? "rejected" : "accepted"} -> Morva must request userVerification: "required" itself`);
}

// 8. Low-S normalisation: with it every signature passes; without it only the low-S half do.
{
  const runs = 10;
  let normalised = 0;
  let rawOk = 0;
  for (let i = 0; i < runs; i++) {
    const p = () => payload(main.accountId, salt, [{ intent: "add_public_key", public_key: backup.publicKey }]);
    if (!(await view("simulate_intents", { signed: [webauthnSign(main, p())] })).error) normalised++;
    if (!(await view("simulate_intents", { signed: [webauthnSign(main, p(), { normalizeS: false })] })).error) rawOk++;
  }
  check(`Low-S signatures accepted every time (${normalised}/${runs})`, normalised === runs, `without normalisation: ${rawOk}/${runs} accepted`);
}

// 9. Device management: in one batch, the original passkey adds a backup, then the backup
//    removes the original. Shows a lost device can be revoked and the account survives it.
{
  const add = webauthnSign(main, payload(main.accountId, salt, [{ intent: "add_public_key", public_key: backup.publicKey }]));
  const remove = webauthnSign(backup, payload(main.accountId, salt, [{ intent: "remove_public_key", public_key: main.publicKey }]));
  const r = await view("simulate_intents", { signed: [add, remove] });
  const events = r.value?.logs?.join(" ") ?? "";
  check("Backup passkey can remove the original passkey (lost-device revocation)", !r.error && events.includes("public_key_removed"), shorten(r.error ?? events.slice(events.indexOf("public_key_removed") - 60)));
}

// 10. (--oneclick) Can 1Click build the intent for a passkey? A real (non-dry) quote with
//     depositType INTENTS creates a deposit address but moves nothing until the intent is
//     submitted, and this script never submits. The payload 1Click returns is signed with the
//     passkey and run through simulate_intents.
if (process.argv.includes("--oneclick")) {
  try {
    process.loadEnvFile();
  } catch {}
  const headers = { "Content-Type": "application/json", ...(process.env.ONECLICK_API_KEY ? { "X-API-Key": process.env.ONECLICK_API_KEY } : {}) };
  const usdc = `nep141:${USDC}`;
  const quoteRes = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers,
    body: JSON.stringify({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 0,
      originAsset: usdc,
      destinationAsset: usdc,
      amount: "1000000",
      depositType: "INTENTS",
      refundTo: main.accountId,
      refundType: "INTENTS",
      recipient: backup.accountId,
      recipientType: "INTENTS",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
  });
  const quote = await quoteRes.json();
  const depositAddress = quote?.quote?.depositAddress;
  console.log(`INFO  real quote: HTTP ${quoteRes.status}, deposit address ${depositAddress ?? shorten(JSON.stringify(quote))}`);
  if (depositAddress) {
    const genRes = await fetch("https://1click.chaindefuser.com/v0/generate-intent", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "swap_transfer", standard: "webauthn", signerId: main.accountId, depositAddress }),
    });
    const gen = await genRes.json();
    const p = gen?.intent?.payload;
    if (genRes.ok && typeof p === "string") {
      console.log(`      1Click webauthn payload: ${shorten(p)}`);
      const r = await view("simulate_intents", { signed: [webauthnSign(main, p)] });
      check(
        "1Click generate-intent (webauthn) payload, signed by the passkey, passes the Verifier up to the balance check",
        /balance|overflow|insufficient/i.test(r.error ?? ""),
        shorten(r.error ?? JSON.stringify(r.value)),
      );
    } else {
      check("1Click generate-intent supports standard webauthn", false, `HTTP ${genRes.status}: ${shorten(JSON.stringify(gen))}`);
    }
  }
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${VERIFIER} via simulate_intents (${RPC}).`);
process.exitCode = failed ? 1 : 0;
