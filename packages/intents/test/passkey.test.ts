import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { derToRawSignature, p256AccountId, p256PublicKeyString, p256SignatureString, rawP256FromCoordinates, toLowS } from "../src/index.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string, size: number) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  return Uint8Array.from(Buffer.from(n.toString(16).padStart(size * 2, "0"), "hex"));
}
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

describe("passkey accounts", () => {
  it("derives the Verifier's implicit account, matching the intents source test vector", () => {
    const raw = base58Decode("3aMVMxsoAnHUbweXMtdKaN1uJaNwsfKv7wnc97SDGjXhyK62VyJwhPUPLZefKVthcoUcuWK6cqkSU4M542ipNxS3", 64);
    assert.equal(p256AccountId(raw), "0x7edf07ede58238026db3f90fc8032633b69b8de5");
    assert.match(p256PublicKeyString(raw), /^p256:3aMVMxso/);
  });

  it("rejects keys and coordinates of the wrong size", () => {
    assert.throws(() => p256AccountId(new Uint8Array(65)), /64-byte/);
    assert.throws(() => rawP256FromCoordinates(new Uint8Array(31), new Uint8Array(32)), /32 bytes/);
  });
});

describe("passkey signatures", () => {
  it("converts DER to r || s with S always in the low half, and stays verifiable", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const msg = Buffer.from("payload");
    let sawHigh = false;
    for (let i = 0; i < 24; i++) {
      const der = sign("sha256", msg, privateKey);
      const raw = derToRawSignature(der);
      if (BigInt(`0x${Buffer.from(raw.subarray(32)).toString("hex")}`) > N / 2n) sawHigh = true;
      const low = toLowS(raw);
      assert.ok(BigInt(`0x${Buffer.from(low.subarray(32)).toString("hex")}`) <= N / 2n);
      const ok = createVerify("sha256").update(msg).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(low));
      assert.ok(ok, "normalised signature still verifies");
      assert.match(p256SignatureString(der), /^p256:[1-9A-HJ-NP-Za-km-z]+$/);
    }
    assert.ok(sawHigh, "the sample included high-S signatures");
  });

  it("rejects malformed DER", () => {
    assert.throws(() => derToRawSignature(Uint8Array.from([0x31, 0x00])), /DER/);
  });
});

describe("passkey intents", async () => {
  const { intentNonce, keyIntentPayload, payloadChallenge, webauthnSignedIntent } = await import("../src/index.ts");

  it("builds the salted nonce layout the Verifier expects", () => {
    const n = Buffer.from(intentNonce("252812b3", new Date("2026-11-02T10:00:00Z"), new Uint8Array(15).fill(7)), "base64");
    assert.equal(n.length, 32);
    assert.equal(n.subarray(0, 9).toString("hex"), "5628f6c600252812b3");
    assert.equal(n.readBigUInt64LE(9), BigInt(Date.parse("2026-11-02T10:00:00Z")) * 1_000_000n);
    assert.ok(n.subarray(17).every(b => b === 7));
    assert.throws(() => intentNonce("xyz", new Date()), /Salt/);
  });

  it("builds an add_public_key payload for the account", () => {
    const p = JSON.parse(keyIntentPayload({ signerId: "0xabc", intent: "add_public_key", publicKey: "p256:K", salt: "252812b3" }));
    assert.equal(p.signer_id, "0xabc");
    assert.equal(p.verifying_contract, "intents.near");
    assert.deepEqual(p.intents, [{ intent: "add_public_key", public_key: "p256:K" }]);
  });

  it("uses sha256 of the payload as the challenge and keeps the assertion intact", async () => {
    assert.equal(await payloadChallenge("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const der = sign("sha256", Buffer.from("m"), privateKey);
    const signed = webauthnSignedIntent({
      payload: "P",
      publicKeyP256: "p256:K",
      assertion: { clientDataJSON: Buffer.from('{"type":"webauthn.get"}').toString("base64url"), authenticatorData: "AAAA", signature: der.toString("base64url") },
    });
    assert.equal(signed.standard, "webauthn");
    assert.equal(signed.payload, "P");
    assert.equal(signed.client_data_json, '{"type":"webauthn.get"}');
    assert.equal(signed.authenticator_data, "AAAA");
    assert.equal(signed.signature, p256SignatureString(der));
  });
});
