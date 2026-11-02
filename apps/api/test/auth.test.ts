import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { connectMemory, listAudit, migrate, type Db } from "@morva/database";
import { p256AccountId, rawP256FromCoordinates } from "@morva/intents";
import { createApp, SESSION_COOKIE } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { RateLimiter } from "../src/rate-limit.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

const config: Config = {
  rpId: "morva.example",
  rpName: "Morva",
  webOrigin: "https://morva.example",
  sessionSecret: "test-secret-test-secret-test-secret-123",
  secureCookies: true,
  trustProxy: true,
  sessionDays: 30,
};

let db: Db;
let app: ReturnType<typeof createApp>;
let sent: { to: string; code: string }[];
let ipCounter = 0;

beforeEach(async () => {
  db = await connectMemory();
  await migrate(db);
  sent = [];
  app = createApp({
    db,
    config,
    mailer: { sendVerificationCode: async (to, code) => void sent.push({ to, code }) },
    limiter: new RateLimiter(),
  });
});
after(() => db?.close());

/** A browser-like client: keeps the session cookie and sends the web app's origin. */
function client(ip = `10.0.0.${++ipCounter}`) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", origin: config.webOrigin, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    return { status: res.status, body: (await res.json()) as Record<string, any>, setCookie: set };
  };
  return { call, get cookie() { return cookie; } };
}

async function signUp(c = client(), auth = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin })) {
  const opts = await c.call("POST", "/v1/auth/register/options");
  const res = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) });
  return { c, auth, opts, res };
}

describe("sign-up with a passkey", () => {
  it("asks for a discoverable, user-verified ES256 passkey on Morva's own domain", async () => {
    const { body } = await client().call("POST", "/v1/auth/register/options");
    assert.equal(body.options.rp.id, "morva.example");
    assert.deepEqual(body.options.pubKeyCredParams.map((p: { alg: number }) => p.alg), [-7]);
    assert.equal(body.options.authenticatorSelection.userVerification, "required");
    assert.equal(body.options.authenticatorSelection.residentKey, "required");
    assert.equal(body.options.attestation, "none");
  });

  it("creates the merchant with the NEAR Intents account derived from the passkey, and signs in", async () => {
    const { res, auth, c } = await signUp();
    assert.equal(res.status, 201);
    const expected = p256AccountId(rawP256FromCoordinates(auth.x, auth.y));
    assert.equal(res.body.merchant.intents_account_id, expected);
    assert.equal(res.body.merchant.onboarding_step, "business");
    assert.equal(res.body.merchant.payout_mode, "keep_in_balance");

    assert.match(res.setCookie!, /HttpOnly/);
    assert.match(res.setCookie!, /Secure/);
    assert.match(res.setCookie!, /SameSite=Lax/);

    const me = await c.call("GET", "/v1/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.merchant.intents_account_id, expected);
    assert.equal(me.body.passkeys.length, 1);
    assert.deepEqual((await listAudit(db, me.body.merchant.id)).map(a => a.type), ["merchant.created", "passkey.added"]);
  });

  it("rejects passkeys without user verification, from another origin, or with another algorithm", async () => {
    for (const [auth, overrides] of [
      [new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin, userVerified: false }), {}],
      [new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin }), { origin: "https://evil.example" }],
      [new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin }), { alg: -8 }],
    ] as const) {
      const c = client();
      const opts = await c.call("POST", "/v1/auth/register/options");
      const res = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options, overrides) });
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.equal(c.cookie, "", "no session");
    }
  });

  it("uses each challenge once", async () => {
    const { opts, auth, c } = await signUp();
    const again = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) });
    assert.equal(again.body.error, "challenge_expired");
  });
});

describe("log in with a passkey", () => {
  it("logs back in with the same passkey and the same account", async () => {
    const { res, auth } = await signUp();
    const c = client();
    const opts = await c.call("POST", "/v1/auth/login/options");
    assert.equal(opts.body.options.userVerification, "required");
    const login = await c.call("POST", "/v1/auth/login/verify", { challengeId: opts.body.challengeId, response: auth.authenticate(opts.body.options.challenge) });
    assert.equal(login.status, 200);
    assert.equal(login.body.merchant.intents_account_id, res.body.merchant.intents_account_id);
    assert.equal((await c.call("GET", "/v1/me")).status, 200);
  });

  it("refuses unknown passkeys, a wrong challenge and assertions from another origin", async () => {
    const { auth } = await signUp();
    const stranger = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin });
    const c = client();
    let opts = await c.call("POST", "/v1/auth/login/options");
    assert.equal((await c.call("POST", "/v1/auth/login/verify", { challengeId: opts.body.challengeId, response: stranger.authenticate(opts.body.options.challenge) })).status, 401);
    opts = await c.call("POST", "/v1/auth/login/options");
    assert.equal((await c.call("POST", "/v1/auth/login/verify", { challengeId: opts.body.challengeId, response: auth.authenticate("not-the-challenge") })).status, 401);
    opts = await c.call("POST", "/v1/auth/login/options");
    assert.equal(
      (await c.call("POST", "/v1/auth/login/verify", { challengeId: opts.body.challengeId, response: auth.authenticate(opts.body.options.challenge, { origin: "https://evil.example" }) })).status,
      401,
    );
    assert.equal((await c.call("GET", "/v1/me")).status, 401);
  });

  it("ends the session on logout", async () => {
    const { c } = await signUp();
    assert.equal((await c.call("POST", "/v1/auth/logout")).status, 200);
    assert.equal((await c.call("GET", "/v1/me")).status, 401);
  });
});

describe("security", () => {
  it("rejects state-changing requests from other origins", async () => {
    const res = await client().call("POST", "/v1/auth/register/options", undefined, { origin: "https://evil.example" });
    assert.equal(res.status, 403);
  });

  it("rate-limits sign-up attempts per IP", async () => {
    const c = client("10.9.9.9");
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await c.call("POST", "/v1/auth/register/options")).status;
    assert.equal(last, 429);
  });
});

describe("contact email", () => {
  it("verifies an email with a 6-digit code", async () => {
    const { c } = await signUp();
    assert.equal((await c.call("POST", "/v1/me/email", { email: "  Owner@Northside.example " })).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "owner@northside.example");
    assert.match(sent[0]!.code, /^\d{6}$/);
    const ok = await c.call("POST", "/v1/me/email/verify", { code: sent[0]!.code });
    assert.deepEqual(ok.body, { verified: true, email: "owner@northside.example" });
    assert.equal((await c.call("GET", "/v1/me")).body.merchant.contact_email_verified, true);
  });

  it("allows five wrong codes, then the code is dead", async () => {
    const { c } = await signUp();
    await c.call("POST", "/v1/me/email", { email: "owner@northside.example" });
    const wrong = sent[0]!.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) assert.equal((await c.call("POST", "/v1/me/email/verify", { code: wrong })).body.error, "code_wrong");
    assert.equal((await c.call("POST", "/v1/me/email/verify", { code: sent[0]!.code })).body.error, "code_expired");
  });

  it("needs a session and a valid address", async () => {
    assert.equal((await client().call("POST", "/v1/me/email", { email: "a@b.co" })).status, 401);
    const { c } = await signUp();
    assert.equal((await c.call("POST", "/v1/me/email", { email: "not-an-email" })).status, 400);
  });
});

describe("handles", () => {
  it("reports availability with a plain reason", async () => {
    const c = client();
    assert.deepEqual((await c.call("GET", "/v1/handles/Northside-Events")).body, { handle: "northside-events", available: true });
    const bad = await c.call("GET", "/v1/handles/admin");
    assert.equal(bad.body.available, false);
    assert.equal(bad.body.reason, "reserved");

    const { res } = await signUp();
    await db.query("UPDATE merchant SET handle = 'northside' WHERE id = $1", [res.body.merchant.id]);
    const taken = await c.call("GET", "/v1/handles/northside");
    assert.equal(taken.body.available, false);
    assert.equal(taken.body.reason, "taken");
  });
});
