import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { p256AccountId, rawP256FromCoordinates } from "@morva/intents";
import { readGoogleIdToken } from "../src/app.ts";
import { config, setup } from "./helpers.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

let env: Awaited<ReturnType<typeof setup>>;
afterEach(() => env?.close());

/** Signs in with an email code and returns the signed-in client. */
async function emailSignIn(email: string) {
  const c = env.client();
  assert.equal((await c.call("POST", "/v1/auth/email/start", { email })).status, 200);
  const code = env.sent.filter(s => s.to === email.toLowerCase()).at(-1)!.code;
  const res = await c.call("POST", "/v1/auth/email/verify", { email, code });
  return { c, res };
}

const idToken = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

const GOOGLE = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "secret" };
const goodClaims = { iss: "https://accounts.google.com", aud: GOOGLE.clientId, exp: Math.floor(Date.now() / 1000) + 600, sub: "g-123", email: "Owner@Northside.example", email_verified: true };

describe("sign up with an email code", () => {
  it("creates a merchant with a verified email and no passkey yet", async () => {
    env = await setup();
    const { c, res } = await emailSignIn("owner@northside.example");
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.merchant.contact_email, "owner@northside.example");
    assert.equal(res.body.merchant.contact_email_verified, true);
    assert.equal(res.body.merchant.has_passkey, false);
    assert.equal(res.body.merchant.intents_account_id, null);
    assert.equal((await c.call("GET", "/v1/me")).status, 200);
  });

  it("logs the same email back into the same merchant", async () => {
    env = await setup();
    const first = await emailSignIn("owner@northside.example");
    const again = await emailSignIn("OWNER@northside.example");
    assert.equal(again.res.status, 200);
    assert.equal(again.res.body.created, false);
    assert.equal(again.res.body.merchant.id, first.res.body.merchant.id);
  });

  it("rejects a wrong code, and kills the code after five tries", async () => {
    env = await setup();
    const c = env.client();
    await c.call("POST", "/v1/auth/email/start", { email: "a@b.example" });
    const real = env.sent.at(-1)!.code;
    const wrong = real === "000000" ? "111111" : "000000";
    const first = await c.call("POST", "/v1/auth/email/verify", { email: "a@b.example", code: wrong });
    assert.equal(first.status, 400);
    assert.equal(first.body.error, "code_wrong");
    for (let i = 0; i < 4; i++) await c.call("POST", "/v1/auth/email/verify", { email: "a@b.example", code: wrong });
    const dead = await c.call("POST", "/v1/auth/email/verify", { email: "a@b.example", code: real });
    assert.equal(dead.body.error, "code_expired");
  });

  it("refuses a malformed email", async () => {
    env = await setup();
    const res = await env.client().call("POST", "/v1/auth/email/start", { email: "not-an-email" });
    assert.equal(res.status, 400);
    assert.equal(env.sent.length, 0);
  });

  it("won't let another merchant claim a verified email", async () => {
    env = await setup();
    await emailSignIn("owner@northside.example");
    const { c } = await env.merchant();
    await c.call("POST", "/v1/me/email", { email: "owner@northside.example" });
    const res = await c.call("POST", "/v1/me/email/verify", { code: env.sent.at(-1)!.code });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "email_taken");
  });
});

describe("protecting the balance with a passkey after email sign-up", () => {
  it("attaches the first passkey to the signed-in merchant and derives its account", async () => {
    env = await setup();
    const { c, res } = await emailSignIn("owner@northside.example");
    const auth = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin });
    const opts = await c.call("POST", "/v1/auth/register/options");
    const reg = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.merchant.id, res.body.merchant.id);
    assert.equal(reg.body.merchant.has_passkey, true);
    assert.equal(reg.body.merchant.intents_account_id, p256AccountId(rawP256FromCoordinates(auth.x, auth.y)));
  });

  it("refuses a second first passkey", async () => {
    env = await setup();
    const { c } = await env.merchant();
    const auth = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin });
    const opts = await c.call("POST", "/v1/auth/register/options");
    const reg = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) });
    assert.equal(reg.status, 409);
    assert.equal(reg.body.error, "has_passkey");
  });

  it("keeps money routes closed until the passkey exists", async () => {
    env = await setup();
    const { c } = await emailSignIn("owner@northside.example");
    const res = await c.call("POST", "/v1/relayer/key-intents", { signed: {} });
    assert.ok([409, 503].includes(res.status));
  });
});

describe("sign in with Google", () => {
  const googleEnv = async (claims: Record<string, unknown>) => {
    const calls: URLSearchParams[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      calls.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });
    }) as typeof fetch;
    env = await setup({ config: { ...config, google: { ...GOOGLE, fetch: fake } } });
    return calls;
  };

  it("says whether Google is offered", async () => {
    env = await setup();
    assert.equal((await env.client().call("GET", "/v1/auth/methods")).body.google, false);
    await env.close();
    await googleEnv(goodClaims);
    assert.equal((await env.client().call("GET", "/v1/auth/methods")).body.google, true);
  });

  it("redirects to Google with state and PKCE, then signs in on the callback", async () => {
    const calls = await googleEnv(goodClaims);
    const c = env.client();
    const start = await c.call("GET", "/v1/auth/google/start");
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location")!);
    assert.equal(to.origin, "https://accounts.google.com");
    assert.equal(to.searchParams.get("code_challenge_method"), "S256");
    assert.equal(to.searchParams.get("redirect_uri"), "https://morva.example/api/v1/auth/google/callback");
    const state = to.searchParams.get("state")!;

    const back = await c.call("GET", `/v1/auth/google/callback?code=abc&state=${state}`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get("location"), "https://morva.example/start");
    assert.ok(calls[0]!.get("code_verifier"));
    const me = await c.call("GET", "/v1/me");
    assert.equal(me.body.merchant.contact_email, "owner@northside.example");
    assert.equal(me.body.merchant.google_linked, true);

    // The state is single-use.
    const replay = await env.client().call("GET", `/v1/auth/google/callback?code=abc&state=${state}`);
    assert.match(replay.headers.get("location")!, /error=google_expired/);
  });

  it("links Google to the merchant who already verified that email", async () => {
    await googleEnv(goodClaims);
    const { res } = await emailSignIn("owner@northside.example");
    const c = env.client();
    const to = new URL((await c.call("GET", "/v1/auth/google/start")).headers.get("location")!);
    await c.call("GET", `/v1/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`);
    assert.equal((await c.call("GET", "/v1/me")).body.merchant.id, res.body.merchant.id);
  });
});

describe("reading Google ID tokens", () => {
  it("accepts good claims and rejects the wrong audience, expiry or unverified email", () => {
    assert.deepEqual(readGoogleIdToken(idToken(goodClaims), GOOGLE.clientId), { sub: "g-123", email: "owner@northside.example" });
    assert.equal(readGoogleIdToken(idToken({ ...goodClaims, aud: "other" }), GOOGLE.clientId), null);
    assert.equal(readGoogleIdToken(idToken({ ...goodClaims, iss: "https://evil.example" }), GOOGLE.clientId), null);
    assert.equal(readGoogleIdToken(idToken({ ...goodClaims, exp: 1 }), GOOGLE.clientId), null);
    assert.equal(readGoogleIdToken(idToken({ ...goodClaims, email_verified: false }), GOOGLE.clientId), null);
    assert.equal(readGoogleIdToken("garbage", GOOGLE.clientId), null);
  });
});
