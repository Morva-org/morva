import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { consoleMailer, mailerFromEnv, resendMailer } from "../src/mailer.ts";
import { keyringFromEnv, openSecret, sealSecret } from "../src/secrets.ts";

describe("webhook secrets at rest", () => {
  const k1 = randomBytes(32).toString("base64");
  const k2 = randomBytes(32).toString("base64");

  it("round-trips through AES-256-GCM and records the key version", () => {
    const ring = keyringFromEnv({ WEBHOOK_SECRET_KEY: k1 })!;
    const sealed = sealSecret(ring, "whsec_test");
    assert.equal(sealed.keyVersion, 1);
    assert.ok(!sealed.ciphertext.includes(Buffer.from("whsec_test")));
    assert.equal(openSecret(ring, sealed.ciphertext, 1), "whsec_test");
  });

  it("detects tampering", () => {
    const ring = keyringFromEnv({ WEBHOOK_SECRET_KEY: k1 })!;
    const sealed = sealSecret(ring, "whsec_test");
    sealed.ciphertext[14]! ^= 0xff;
    assert.throws(() => openSecret(ring, sealed.ciphertext, 1));
  });

  it("rotates: new secrets use the new key, old ones stay readable", () => {
    const old = sealSecret(keyringFromEnv({ WEBHOOK_SECRET_KEY: k1 })!, "old");
    const ring = keyringFromEnv({ WEBHOOK_SECRET_KEY: k2, WEBHOOK_SECRET_KEY_VERSION: "2", WEBHOOK_SECRET_KEY_PREVIOUS: k1 })!;
    assert.equal(openSecret(ring, old.ciphertext, 1), "old");
    const fresh = sealSecret(ring, "new");
    assert.equal(fresh.keyVersion, 2);
    assert.equal(openSecret(ring, fresh.ciphertext, 2), "new");
    assert.throws(() => openSecret(ring, fresh.ciphertext, 3), /No webhook secret key/);
  });

  it("rejects keys that aren't 32 bytes", () => {
    assert.throws(() => keyringFromEnv({ WEBHOOK_SECRET_KEY: "c2hvcnQ=" }), /32 bytes/);
    assert.equal(keyringFromEnv({}), null);
  });
});

describe("mailer", () => {
  it("falls back to the console without RESEND_API_KEY", () => {
    assert.equal(mailerFromEnv({}), consoleMailer);
    assert.throws(() => mailerFromEnv({ RESEND_API_KEY: "re_x" }), /MAIL_FROM/);
  });

  it("sends the code through Resend from the mail subdomain", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer({ apiKey: "re_test", from: "Morva <no-reply@mail.morva.example>", fetcher }).sendVerificationCode("owner@northside.example", "123456");
    assert.equal(calls[0]!.url, "https://api.resend.com/emails");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer re_test");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body.to, ["owner@northside.example"]);
    assert.equal(body.from, "Morva <no-reply@mail.morva.example>");
    assert.match(body.text, /123456/);
  });

  it("surfaces Resend errors", async () => {
    const fetcher = (async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(resendMailer({ apiKey: "k", from: "f", fetcher }).sendVerificationCode("a@b.co", "1"), /403/);
  });
});
