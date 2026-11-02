// Passkeys (WebAuthn, P-256) as NEAR Intents accounts. See docs/PAYMENT_SPIKE.md, findings 13-17.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58 } from "./erc191.ts";
import { IntentsError } from "./errors.ts";

/** P-256 group order. */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntTo32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function expectRawKey(raw: Uint8Array) {
  if (raw.length !== 64) throw new IntentsError("invalid_request", "Expected a 64-byte uncompressed P-256 public key (x || y)");
}

/**
 * The merchant's NEAR Intents account for a passkey: "0x" + hex(keccak256("p256" || x || y)[12..32]).
 * Derived from the first passkey and never changes.
 */
export function p256AccountId(rawPublicKey: Uint8Array): string {
  expectRawKey(rawPublicKey);
  const prefixed = new Uint8Array(4 + 64);
  prefixed.set(new TextEncoder().encode("p256"));
  prefixed.set(rawPublicKey, 4);
  return `0x${hex(keccak_256(prefixed).subarray(12))}`;
}

/** The Verifier's encoding of a passkey public key: "p256:" + base58(x || y). */
export function p256PublicKeyString(rawPublicKey: Uint8Array): string {
  expectRawKey(rawPublicKey);
  return `p256:${base58(rawPublicKey)}`;
}

/** Raw x || y from the x and y coordinates of a COSE EC2 key (as SimpleWebAuthn decodes them). */
export function rawP256FromCoordinates(x: Uint8Array, y: Uint8Array): Uint8Array {
  if (x.length !== 32 || y.length !== 32) throw new IntentsError("invalid_request", "P-256 coordinates must be 32 bytes each");
  const raw = new Uint8Array(64);
  raw.set(x);
  raw.set(y, 32);
  return raw;
}

/**
 * Authenticators return either of the two valid S values; the Verifier accepts only the low one.
 * Takes r || s (64 bytes) and returns it with S normalised.
 */
export function toLowS(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new IntentsError("invalid_request", "Expected a 64-byte r || s signature");
  const s = bytesToBigInt(signature.subarray(32));
  if (s <= N / 2n) return signature;
  const out = new Uint8Array(64);
  out.set(signature.subarray(0, 32));
  out.set(bigIntTo32(N - s), 32);
  return out;
}

/** DER ECDSA signature (what WebAuthn returns) to raw r || s, each left-padded to 32 bytes. */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  const fail = () => {
    throw new IntentsError("invalid_request", "Malformed DER signature");
  };
  if (der[0] !== 0x30) fail();
  let i = 2;
  const readInt = () => {
    if (der[i] !== 0x02) fail();
    const len = der[i + 1]!;
    let value = der.subarray(i + 2, i + 2 + len);
    i += 2 + len;
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) fail();
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

/** The Verifier's encoding of a passkey signature: "p256:" + base58(r || low-S s). */
export function p256SignatureString(derSignature: Uint8Array): string {
  return `p256:${base58(toLowS(derToRawSignature(derSignature)))}`;
}

// --- browser-side helpers for passkey-signed intents ---------------------------------------

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Nonce: magic 5628f6c6 | version 0 | 4-byte salt | deadline (u64 ns, LE) | 15 random bytes. */
export function intentNonce(saltHex: string, deadline: Date, random15: Uint8Array = crypto.getRandomValues(new Uint8Array(15))): string {
  if (!/^[0-9a-f]{8}$/.test(saltHex)) throw new IntentsError("invalid_request", "Salt must be 4 bytes of hex");
  if (random15.length !== 15) throw new IntentsError("invalid_request", "Nonce needs 15 random bytes");
  const out = new Uint8Array(32);
  out.set([0x56, 0x28, 0xf6, 0xc6, 0x00]);
  for (let i = 0; i < 4; i++) out[5 + i] = parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  let ns = BigInt(deadline.getTime()) * 1_000_000n;
  for (let i = 0; i < 8; i++) {
    out[9 + i] = Number(ns & 0xffn);
    ns >>= 8n;
  }
  out.set(random15, 17);
  return bytesToBase64(out);
}

export type KeyIntent = "add_public_key" | "remove_public_key";

/** The payload a passkey signs to add or remove another passkey on its account. */
export function keyIntentPayload(o: { signerId: string; intent: KeyIntent; publicKey: string; salt: string; deadline?: Date }): string {
  const deadline = o.deadline ?? new Date(Date.now() + 10 * 60_000);
  return JSON.stringify({
    signer_id: o.signerId,
    verifying_contract: "intents.near",
    deadline: deadline.toISOString(),
    nonce: intentNonce(o.salt, deadline),
    intents: [{ intent: o.intent, public_key: o.publicKey }],
  });
}

/** The WebAuthn challenge for a payload: sha256 of the exact payload string, base64url. */
export async function payloadChallenge(payload: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
  return bytesToBase64(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface WebauthnSignedIntent {
  standard: "webauthn";
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
}

/** Turns a WebAuthn assertion (base64url fields, as browsers and SimpleWebAuthn return them) into the Verifier's format. */
export function webauthnSignedIntent(o: {
  payload: string;
  publicKeyP256: string;
  assertion: { clientDataJSON: string; authenticatorData: string; signature: string };
}): WebauthnSignedIntent {
  return {
    standard: "webauthn",
    payload: o.payload,
    public_key: o.publicKeyP256,
    signature: p256SignatureString(base64urlToBytes(o.assertion.signature)),
    client_data_json: new TextDecoder().decode(base64urlToBytes(o.assertion.clientDataJSON)),
    authenticator_data: o.assertion.authenticatorData,
  };
}
