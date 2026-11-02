// The Morva API: merchant sign-up and login with passkeys, sessions, email verification.
// Passkey private keys never leave the merchant's device; the server stores public keys only.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import {
  attachFirstPasskey,
  consumeChallenge,
  consumeOAuthState,
  createChallenge,
  createLoginCode,
  createMerchantFromEmail,
  createOAuthState,
  findMerchantByGoogleSub,
  findMerchantByVerifiedEmail,
  latestLoginCode,
  linkGoogle,
  recordLoginCodeAttempt,
  createEmailCode,
  createMerchantWithPasskey,
  createSession,
  deleteSession,
  findPasskeyByCredentialId,
  getMerchant,
  getSessionMerchant,
  isHandleTaken,
  latestEmailCode,
  listPasskeys,
  recordAudit,
  recordEmailCodeAttempt,
  recordPasskeyUse,
  setContactEmail,
  type Db,
  type Merchant,
} from "@morva/database";
import { normalizeHandle, validateHandle } from "@morva/domain";
import { p256AccountId, p256PublicKeyString, rawP256FromCoordinates, type OneClickClient } from "@morva/intents";
import type { Config } from "./config.ts";
import type { Mailer } from "./mailer.ts";
import { LIMITS, RateLimiter, type Limit } from "./rate-limit.ts";
import { registerOnboarding } from "./onboarding.ts";
import type { Relayer } from "./relayer.ts";

export const SESSION_COOKIE = "morva_session";
const ES256 = -7;
const CHALLENGE_TTL_MS = 5 * 60_000;
const EMAIL_CODE_TTL_MS = 10 * 60_000;
const EMAIL_CODE_ATTEMPTS = 5;

type Env = { Variables: { merchant: Merchant; ip: string } };

export interface Deps {
  db: Db;
  config: Config;
  mailer: Mailer;
  limiter?: RateLimiter;
  relayer?: Relayer | null;
  oneclick?: OneClickClient | null;
  verifierRpcUrl?: string;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function createApp({ db, config, mailer, limiter = new RateLimiter(db), relayer = null, oneclick = null, verifierRpcUrl }: Deps) {
  const app = new Hono<Env>();

  // Client IP, for rate limits. Behind a proxy, only trusted when configured.
  app.use("*", async (c, next) => {
    const forwarded = config.trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    c.set("ip", forwarded || incoming?.socket?.remoteAddress || "unknown");
    await next();
  });

  // CSRF: state-changing requests must come from the web app's own origin.
  app.use("/v1/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== config.webOrigin) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    await next();
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  const limit = async (c: Context<Env>, name: keyof typeof LIMITS, key: string, l: Limit = LIMITS[name]) => {
    const r = await limiter.hit(`${name}:${key}`, l);
    if (r.ok) return null;
    c.header("Retry-After", String(r.retryAfter));
    return c.json({ error: "rate_limited", retry_after: r.retryAfter }, 429);
  };

  const startSession = async (c: Context<Env>, merchantId: string) => {
    const token = randomBytes(32);
    const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
    await createSession(db, sha256(token), merchantId, expires, c.req.header("user-agent") ?? null);
    setCookie(c, SESSION_COOKIE, b64url(token), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      path: "/",
      expires,
    });
  };

  const sessionHash = (c: Context<Env>) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? sha256(Buffer.from(token, "base64url")) : null;
  };

  const requireMerchant = async (c: Context<Env>, next: () => Promise<void>) => {
    const hash = sessionHash(c);
    const merchant = hash ? await getSessionMerchant(db, hash) : null;
    if (!merchant) return c.json({ error: "unauthenticated" }, 401);
    c.set("merchant", merchant);
    await next();
  };

  // --- sign-up: create a passkey, derive the merchant's NEAR Intents account -------------

  app.post("/v1/auth/register/options", async c => {
    const limited = await limit(c, "register", c.get("ip"));
    if (limited) return limited;
    const userId = randomBytes(16);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: "Morva merchant",
      userDisplayName: "Morva merchant",
      userID: userId,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [ES256],
    });
    const challengeId = await createChallenge(db, {
      purpose: "register",
      challenge: options.challenge,
      userHandle: b64url(userId),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    return c.json({ challengeId, options });
  });

  app.post("/v1/auth/register/verify", async c => {
    const limited = await limit(c, "register", c.get("ip"));
    if (limited) return limited;
    const body = await c.req.json<{ challengeId?: string; response?: RegistrationResponseJSON; deviceLabel?: string }>().catch(() => ({}) as never);
    if (!body.challengeId || !body.response) return c.json({ error: "invalid_request" }, 400);
    const challenge = await consumeChallenge(db, body.challengeId, "register");
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [ES256],
      });
    } catch {
      return c.json({ error: "passkey_rejected" }, 400);
    }
    if (!verification.verified) return c.json({ error: "passkey_rejected" }, 400);
    const { credential, credentialBackedUp } = verification.registrationInfo;

    // The passkey's public key defines the merchant's NEAR Intents account (PAYMENT_SPIKE finding 13).
    const key = decodeCredentialPublicKey(credential.publicKey);
    const x = key.get(cose.COSEKEYS.x as never) as Uint8Array | undefined;
    const y = key.get(cose.COSEKEYS.y as never) as Uint8Array | undefined;
    if (key.get(cose.COSEKEYS.alg) !== ES256 || !x || !y) return c.json({ error: "unsupported_key" }, 400);
    const raw = rawP256FromCoordinates(x, y);

    if (await findPasskeyByCredentialId(db, credential.id)) return c.json({ error: "passkey_exists" }, 409);
    const newPasskey = {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      publicKeyP256: p256PublicKeyString(raw),
      signCount: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
      deviceLabel: body.deviceLabel?.slice(0, 60) ?? null,
    };

    // Signed in with email or Google: this first passkey protects their balance.
    const hash = sessionHash(c);
    const current = hash ? await getSessionMerchant(db, hash) : null;
    if (current) {
      if (current.intents_account_id) return c.json({ error: "has_passkey", message: "You already have a passkey. Add another device in Settings." }, 409);
      const merchant = await attachFirstPasskey(db, current.id, p256AccountId(raw), newPasskey);
      return c.json({ merchant: publicMerchant(merchant) }, 201);
    }

    // Signing up with a passkey: the passkey creates the account.
    const { merchant } = await createMerchantWithPasskey(db, p256AccountId(raw), newPasskey);
    await startSession(c, merchant.id);
    return c.json({ merchant: publicMerchant(merchant) }, 201);
  });

  // --- log in with a passkey -----------------------------------------------------------

  app.post("/v1/auth/login/options", async c => {
    const limited = await limit(c, "login", c.get("ip"));
    if (limited) return limited;
    // Discoverable credentials: the browser offers whichever Morva passkeys are on the device.
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "required", allowCredentials: [] });
    const challengeId = await createChallenge(db, { purpose: "login", challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
    return c.json({ challengeId, options });
  });

  app.post("/v1/auth/login/verify", async c => {
    const limited = await limit(c, "login", c.get("ip"));
    if (limited) return limited;
    const body = await c.req.json<{ challengeId?: string; response?: AuthenticationResponseJSON }>().catch(() => ({}) as never);
    if (!body.challengeId || !body.response) return c.json({ error: "invalid_request" }, 400);
    const challenge = await consumeChallenge(db, body.challengeId, "login");
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);
    const passkey = await findPasskeyByCredentialId(db, body.response.id);
    if (!passkey) return c.json({ error: "passkey_unknown" }, 401);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpId,
        credential: { id: passkey.credential_id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.sign_count, transports: passkey.transports },
        requireUserVerification: true,
      });
    } catch {
      return c.json({ error: "passkey_rejected" }, 401);
    }
    if (!verification.verified) return c.json({ error: "passkey_rejected" }, 401);
    await recordPasskeyUse(db, passkey.id, verification.authenticationInfo.newCounter);
    await recordAudit(db, passkey.merchant_id, "login", { credential_id: passkey.credential_id });
    await startSession(c, passkey.merchant_id);
    const merchant = await getMerchant(db, passkey.merchant_id);
    return c.json({ merchant: publicMerchant(merchant!) });
  });

  app.post("/v1/auth/logout", async c => {
    const hash = sessionHash(c);
    if (hash) await deleteSession(db, hash);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.secureCookies });
    return c.json({ ok: true });
  });

  // --- sign up or log in with an email code ----------------------------------------------
  // One flow for both: the code proves the email, then we find or create its merchant.

  app.post("/v1/auth/email/start", async c => {
    const b = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    const email = b.email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return c.json({ error: "invalid_email", message: "Check your email address." }, 400);
    const limited = (await limit(c, "emailSend", `ip:${c.get("ip")}`)) ?? (await limit(c, "emailSend", `email:${email}`));
    if (limited) return limited;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await createLoginCode(db, email, loginCodeHash(config, email, code), new Date(Date.now() + EMAIL_CODE_TTL_MS));
    await mailer.sendVerificationCode(email, code);
    return c.json({ sent: true });
  });

  app.post("/v1/auth/email/verify", async c => {
    const b = await c.req.json<{ email?: string; code?: string }>().catch(() => ({}) as { email?: string; code?: string });
    const email = b.email?.trim().toLowerCase() ?? "";
    const limited = await limit(c, "emailVerify", `email:${email}`);
    if (limited) return limited;
    const pending = email ? await latestLoginCode(db, email) : null;
    if (!pending || pending.expires_at.getTime() < Date.now() || pending.attempts >= EMAIL_CODE_ATTEMPTS) {
      return c.json({ error: "code_expired", message: "That code has expired. Send a new one." }, 400);
    }
    const ok = typeof b.code === "string" && /^\d{6}$/.test(b.code) && timingSafeEqual(Buffer.from(pending.code_hash), loginCodeHash(config, email, b.code));
    await recordLoginCodeAttempt(db, pending.id, ok);
    if (!ok) return c.json({ error: "code_wrong", message: "That code isn’t right. Check the email and try again.", attempts_left: EMAIL_CODE_ATTEMPTS - pending.attempts - 1 }, 400);
    const existing = await findMerchantByVerifiedEmail(db, email);
    const merchant = existing ?? (await createMerchantFromEmail(db, email));
    await recordAudit(db, merchant.id, "login", { via: "email" });
    await startSession(c, merchant.id);
    return c.json({ merchant: publicMerchant(merchant), created: !existing }, existing ? 200 : 201);
  });

  // --- sign up or log in with Google (OpenID Connect, authorization code + PKCE) ---------

  const google = config.google;
  const googleRedirect = `${config.webOrigin}/api/v1/auth/google/callback`;

  app.get("/v1/auth/methods", c => c.json({ email: true, google: Boolean(google), passkey: true }));

  app.get("/v1/auth/google/start", async c => {
    if (!google) return c.json({ error: "unavailable" }, 404);
    const limited = await limit(c, "login", c.get("ip"));
    if (limited) return limited;
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    await createOAuthState(db, state, verifier, new Date(Date.now() + 10 * 60_000));
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: googleRedirect,
      response_type: "code",
      scope: "openid email",
      state,
      code_challenge: b64url(sha256(verifier)),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/v1/auth/google/callback", async c => {
    const fail = (reason: string) => c.redirect(`${config.webOrigin}/start?error=${reason}`, 302);
    if (!google) return fail("google_unavailable");
    const { code, state } = c.req.query();
    const verifier = state ? await consumeOAuthState(db, state) : null;
    if (!code || !verifier) return fail("google_expired");
    const tokenRes = await (google.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: googleRedirect, grant_type: "authorization_code", code_verifier: verifier }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!tokenRes?.ok) return fail("google_failed");
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    const claims = id_token ? readGoogleIdToken(id_token, google.clientId) : null;
    if (!claims) return fail("google_failed");

    let merchant = await findMerchantByGoogleSub(db, claims.sub);
    if (!merchant) {
      const byEmail = await findMerchantByVerifiedEmail(db, claims.email);
      if (byEmail) {
        await linkGoogle(db, byEmail.id, claims.sub);
        merchant = byEmail;
      } else {
        merchant = await createMerchantFromEmail(db, claims.email, claims.sub);
      }
    }
    await recordAudit(db, merchant.id, "login", { via: "google" });
    await startSession(c, merchant.id);
    return c.redirect(`${config.webOrigin}/start`, 302);
  });

  // --- the signed-in merchant ----------------------------------------------------------

  app.get("/v1/me", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const passkeys = await listPasskeys(db, merchant.id);
    return c.json({
      merchant: publicMerchant(merchant),
      passkeys: passkeys.map(p => ({ id: p.id, device_label: p.device_label, created_at: p.created_at, last_used_at: p.last_used_at, backed_up: p.backed_up })),
    });
  });

  // Handle availability, for the live check on the business screen.
  app.get("/v1/handles/:handle", async c => {
    const limited = await limit(c, "handleCheck", c.get("ip"));
    if (limited) return limited;
    const handle = normalizeHandle(c.req.param("handle"));
    const valid = validateHandle(handle);
    if (!valid.ok) return c.json({ handle, available: false, reason: valid.problem, message: valid.message });
    const hash = sessionHash(c);
    const me = hash ? await getSessionMerchant(db, hash) : null;
    const taken = await isHandleTaken(db, handle, me?.id);
    return c.json({ handle, available: !taken, ...(taken ? { reason: "taken", message: "That name is taken. Try another." } : {}) });
  });

  // --- contact email: for notifications and recovery contact; it can never move funds --------

  app.post("/v1/me/email", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await limit(c, "emailSend", merchant.id);
    if (limited) return limited;
    const { email } = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    const clean = email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) return c.json({ error: "invalid_email" }, 400);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await createEmailCode(db, merchant.id, clean, emailCodeHash(config, merchant.id, code), new Date(Date.now() + EMAIL_CODE_TTL_MS));
    await mailer.sendVerificationCode(clean, code);
    return c.json({ sent: true });
  });

  app.post("/v1/me/email/verify", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await limit(c, "emailVerify", merchant.id);
    if (limited) return limited;
    const { code } = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string });
    const pending = await latestEmailCode(db, merchant.id);
    if (!pending || pending.expires_at.getTime() < Date.now() || pending.attempts >= EMAIL_CODE_ATTEMPTS) {
      return c.json({ error: "code_expired" }, 400);
    }
    const ok = typeof code === "string" && /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(pending.code_hash), emailCodeHash(config, merchant.id, code));
    await recordEmailCodeAttempt(db, pending.id, ok);
    if (!ok) return c.json({ error: "code_wrong", attempts_left: EMAIL_CODE_ATTEMPTS - pending.attempts - 1 }, 400);
    const owner = await findMerchantByVerifiedEmail(db, pending.email);
    if (owner && owner.id !== merchant.id) return c.json({ error: "email_taken", message: "Another Morva account uses this email. Log in with it instead." }, 409);
    await setContactEmail(db, merchant.id, pending.email);
    return c.json({ verified: true, email: pending.email });
  });

  registerOnboarding(app, { db, config, limit, requireMerchant, publicMerchant, relayer, oneclick, verifierRpcUrl });

  return app;
}

function loginCodeHash(config: Config, email: string, code: string): Buffer {
  return createHmac("sha256", config.sessionSecret).update(`login:${email}:${code}`).digest();
}

/**
 * Reads a Google ID token received straight from Google's token endpoint over TLS (with our client
 * secret), so OpenID Connect allows trusting it without re-checking the signature. The claims are
 * still checked: issuer, audience, expiry and a verified email.
 */
export function readGoogleIdToken(token: string, clientId: string, now = Date.now()): { sub: string; email: string } | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
    if (claims.aud !== clientId) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    if (claims.email_verified !== true || typeof claims.email !== "string" || typeof claims.sub !== "string") return null;
    return { sub: claims.sub, email: claims.email.toLowerCase() };
  } catch {
    return null;
  }
}

function emailCodeHash(config: Config, merchantId: string, code: string): Buffer {
  return createHmac("sha256", config.sessionSecret).update(`${merchantId}:${code}`).digest();
}

/** What the web app may see about a merchant. */
export function publicMerchant(m: Merchant) {
  return {
    id: m.id,
    handle: m.handle,
    business_name: m.business_name,
    logo_url: m.logo_url,
    country: m.country,
    contact_email: m.contact_email,
    contact_email_verified: Boolean(m.contact_email_verified_at),
    intents_account_id: m.intents_account_id,
    has_passkey: Boolean(m.intents_account_id),
    google_linked: Boolean(m.google_sub),
    settlement_asset: m.settlement_asset,
    payout_mode: m.payout_mode,
    payout_chain: m.payout_chain,
    payout_address: m.payout_address,
    payout_threshold: m.payout_threshold,
    refund_policy_default: m.refund_policy_default,
    hold_by_default: m.hold_by_default,
    confidential_default: m.confidential_default,
    sales_channels: m.sales_channels,
    terms_accepted: Boolean(m.terms_accepted_at),
    onboarding_step: m.onboarding_step,
    live: Boolean(m.live_at),
  };
}
