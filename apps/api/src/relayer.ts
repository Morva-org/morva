// The passkey relayer. Adding or removing a merchant's passkey on intents.near is an intent, but
// not a swap, so 1Click can't submit it (PAYMENT_SPIKE.md finding 18). The relayer submits it and
// pays the NEAR gas.
//
// Rules: it accepts only already-signed add_public_key / remove_public_key intents for the
// merchant's own account, simulates before submitting, and forwards the signed object exactly
// as received. It never constructs or alters an intent. Its gas key can't move merchant funds.
import { simulateIntents, type Simulation } from "@morva/intents";
import type { Passkey } from "@morva/database";

export interface Relayer {
  simulate(signed: SignedKeyIntent): Promise<Simulation>;
  submit(signed: SignedKeyIntent): Promise<{ txHash: string }>;
}

export interface SignedKeyIntent {
  standard: "webauthn";
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
}

const FIELDS = ["standard", "payload", "public_key", "signature", "client_data_json", "authenticator_data"] as const;
const MAX_DEADLINE_MS = 60 * 60_000;

export type KeyIntentCheck =
  | { ok: true; signed: SignedKeyIntent; intent: "add_public_key" | "remove_public_key"; publicKey: string }
  | { ok: false; error: string; message: string };

/**
 * Checks a signed key intent against the merchant before anything is sent anywhere. The
 * signature itself is checked by the Verifier, in simulation and again on execution.
 */
export function checkKeyIntent(input: unknown, merchant: { intents_account_id: string }, passkeys: Passkey[], now = Date.now()): KeyIntentCheck {
  const fail = (error: string, message: string): KeyIntentCheck => ({ ok: false, error, message });
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("invalid_request", "Send one signed intent.");
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some(k => !(FIELDS as readonly string[]).includes(k)) || FIELDS.some(k => typeof obj[k] !== "string")) {
    return fail("invalid_request", "The signed intent has unexpected fields.");
  }
  if (obj.standard !== "webauthn") return fail("invalid_request", "Only passkey-signed intents are accepted.");
  const signed = obj as unknown as SignedKeyIntent;

  let payload: { signer_id?: unknown; verifying_contract?: unknown; deadline?: unknown; intents?: unknown };
  try {
    payload = JSON.parse(signed.payload);
  } catch {
    return fail("invalid_request", "The payload isn't valid JSON.");
  }
  if (payload.signer_id !== merchant.intents_account_id) return fail("wrong_account", "This intent is for a different account.");
  if (payload.verifying_contract !== "intents.near") return fail("invalid_request", "This intent is for a different contract.");
  const deadline = typeof payload.deadline === "string" ? Date.parse(payload.deadline) : NaN;
  if (!(deadline > now && deadline <= now + MAX_DEADLINE_MS)) return fail("invalid_request", "The intent's deadline must be within the next hour.");
  if (!Array.isArray(payload.intents) || payload.intents.length !== 1) return fail("invalid_request", "Send exactly one key change.");
  const intent = payload.intents[0] as { intent?: unknown; public_key?: unknown };
  if (intent.intent !== "add_public_key" && intent.intent !== "remove_public_key") return fail("not_allowed", "The relayer only submits passkey changes.");
  if (typeof intent.public_key !== "string" || !intent.public_key.startsWith("p256:")) return fail("invalid_request", "The key must be a passkey.");

  const registered = passkeys.filter(p => p.registered_on_verifier_at);
  if (!registered.some(p => p.public_key_p256 === signed.public_key)) return fail("unknown_signer", "Sign with a passkey already on this account.");
  const target = passkeys.find(p => p.public_key_p256 === intent.public_key);
  if (intent.intent === "add_public_key") {
    if (!target) return fail("unknown_key", "Add the new device in Morva first.");
    if (target.registered_on_verifier_at) return fail("already_registered", "That device is already on your account.");
  } else {
    if (!target?.registered_on_verifier_at) return fail("unknown_key", "That device isn't on your account.");
    if (registered.length < 2) return fail("last_device", "You can't remove your only device. Add another one first.");
  }
  return { ok: true, signed, intent: intent.intent, publicKey: intent.public_key };
}

/** The live relayer: simulate over NEAR RPC, submit with the gas wallet, warn when it runs low. */
export async function nearRelayer(o: {
  accountId: string;
  privateKey: string;
  rpcUrl?: string;
  lowBalanceYocto: bigint;
  log?: (msg: string) => void;
}): Promise<Relayer> {
  const { Account, JsonRpcProvider, teraToGas } = await import("near-api-js");
  const rpcUrl = o.rpcUrl ?? "https://rpc.mainnet.fastnear.com";
  const account = new Account(o.accountId, new JsonRpcProvider({ url: rpcUrl }), o.privateKey as `ed25519:${string}`);
  const log = o.log ?? (m => console.warn(m));
  return {
    simulate: signed => simulateIntents([signed], { rpcUrl }),
    async submit(signed) {
      const result = await account.callFunctionRaw({
        contractId: "intents.near",
        methodName: "execute_intents",
        args: { signed: [signed] },
        gas: teraToGas("100"),
        deposit: 0n,
      });
      const balance = await account.getBalance().catch(() => null);
      if (balance !== null && balance < o.lowBalanceYocto) {
        log(`[relayer] LOW BALANCE: gas wallet ${o.accountId} has ${balance} yoctoNEAR, below ${o.lowBalanceYocto}. Top it up.`);
      }
      return { txHash: result.transaction.hash };
    },
  };
}

/** From env, or null when the relayer isn't configured (adding a backup device is then unavailable). */
export async function relayerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Relayer | null> {
  if (!env.RELAYER_ACCOUNT_ID || !env.RELAYER_PRIVATE_KEY) return null;
  const low = env.RELAYER_LOW_BALANCE_NEAR ?? "1";
  const [whole = "0", frac = ""] = low.split(".");
  const lowBalanceYocto = BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24));
  return nearRelayer({ accountId: env.RELAYER_ACCOUNT_ID, privateKey: env.RELAYER_PRIVATE_KEY, rpcUrl: env.NEAR_RPC_URL || undefined, lowBalanceYocto });
}
