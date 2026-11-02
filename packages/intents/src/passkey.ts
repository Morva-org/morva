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
