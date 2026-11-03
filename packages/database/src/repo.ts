// Typed queries over the schema in migrations/. Every function takes a Db, so callers can run
// several of them in one transaction.
import type { Db } from "./db.ts";

export interface Merchant {
  id: string;
  handle: string | null;
  business_name: string | null;
  logo_url: string | null;
  country: string | null;
  contact_email: string | null;
  contact_email_verified_at: Date | null;
  /** Set when the merchant creates their first passkey; empty before that. */
  intents_account_id: string | null;
  google_sub: string | null;
  settlement_asset: string;
  payout_mode: "keep_in_balance" | "auto_payout";
  payout_chain: string | null;
  payout_address: string | null;
  payout_threshold: string | null;
  refund_policy_default: "full_to_source" | "none";
  hold_by_default: boolean;
  confidential_default: boolean;
  sales_channels: string[];
  terms_accepted_at: Date | null;
  onboarding_step: string;
  live_at: Date | null;
  created_at: Date;
}

export interface Passkey {
  id: string;
  merchant_id: string;
  credential_id: string;
  public_key: Uint8Array;
  public_key_p256: string;
  sign_count: number;
  transports: string[];
  backed_up: boolean;
  device_label: string | null;
  registered_on_verifier_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
}

export interface NewPasskey {
  credentialId: string;
  publicKey: Uint8Array;
  publicKeyP256: string;
  signCount: number;
  transports: string[];
  backedUp: boolean;
  deviceLabel?: string | null;
}

/** node-postgres returns bigint as a string and PGlite as a number; passkey counters are small. */
const toPasskey = (row: Passkey): Passkey => ({ ...row, sign_count: Number(row.sign_count) });

// --- merchants --------------------------------------------------------------------------

/** A merchant is created together with its first passkey, which defines its NEAR Intents account. */
export async function createMerchantWithPasskey(db: Db, intentsAccountId: string, passkey: NewPasskey): Promise<{ merchant: Merchant; passkey: Passkey }> {
  return db.transaction(async tx => {
    const [merchant] = await tx.query<Merchant>("INSERT INTO merchant (intents_account_id) VALUES ($1) RETURNING *", [intentsAccountId]);
    // The first passkey's key is the account's own key on the Verifier: registered by definition.
    const [pk] = await tx.query<Passkey>(
      `INSERT INTO passkey (merchant_id, credential_id, public_key, public_key_p256, sign_count, transports, backed_up, device_label, registered_on_verifier_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [merchant!.id, passkey.credentialId, passkey.publicKey, passkey.publicKeyP256, passkey.signCount, passkey.transports, passkey.backedUp, passkey.deviceLabel ?? null],
    );
    await recordAudit(tx, merchant!.id, "merchant.created", { intents_account_id: intentsAccountId });
    await recordAudit(tx, merchant!.id, "passkey.added", { credential_id: passkey.credentialId, first: true });
    return { merchant: merchant!, passkey: toPasskey(pk!) };
  });
}

export async function getMerchant(db: Db, id: string): Promise<Merchant | null> {
  return (await db.query<Merchant>("SELECT * FROM merchant WHERE id = $1", [id]))[0] ?? null;
}

export async function isHandleTaken(db: Db, handle: string, exceptMerchantId?: string): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM merchant WHERE handle = $1 AND id IS DISTINCT FROM $2", [handle, exceptMerchantId ?? null]);
  return rows.length > 0;
}

export async function setContactEmail(db: Db, merchantId: string, email: string): Promise<void> {
  await db.query("UPDATE merchant SET contact_email = $2, contact_email_verified_at = now() WHERE id = $1", [merchantId, email]);
  await recordAudit(db, merchantId, "email.verified", { email });
}

// --- passkeys ---------------------------------------------------------------------------

export async function findPasskeyByCredentialId(db: Db, credentialId: string): Promise<Passkey | null> {
  const row = (await db.query<Passkey>("SELECT * FROM passkey WHERE credential_id = $1 AND removed_at IS NULL", [credentialId]))[0];
  return row ? toPasskey(row) : null;
}

export async function listPasskeys(db: Db, merchantId: string): Promise<Passkey[]> {
  return (await db.query<Passkey>("SELECT * FROM passkey WHERE merchant_id = $1 AND removed_at IS NULL ORDER BY created_at", [merchantId])).map(toPasskey);
}

export async function countActivePasskeys(db: Db, merchantId: string): Promise<number> {
  const [row] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM passkey WHERE merchant_id = $1 AND removed_at IS NULL", [merchantId]);
  return row?.n ?? 0;
}

/** Records a successful assertion. A counter that goes backwards suggests a cloned credential. */
export async function recordPasskeyUse(db: Db, passkeyId: string, signCount: number): Promise<void> {
  await db.query("UPDATE passkey SET sign_count = GREATEST(sign_count, $2), last_used_at = now() WHERE id = $1", [passkeyId, signCount]);
}

// --- sessions ---------------------------------------------------------------------------

export async function createSession(db: Db, tokenHash: Uint8Array, merchantId: string, expiresAt: Date, userAgent: string | null): Promise<void> {
  await db.query("INSERT INTO session (token_hash, merchant_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)", [tokenHash, merchantId, expiresAt, userAgent]);
}

export async function getSessionMerchant(db: Db, tokenHash: Uint8Array): Promise<Merchant | null> {
  const rows = await db.query<Merchant>(
    `UPDATE session SET last_seen_at = now() WHERE token_hash = $1 AND expires_at > now()
     RETURNING (SELECT row_to_json(m) FROM merchant m WHERE m.id = session.merchant_id) AS merchant`,
    [tokenHash],
  );
  const merchant = (rows[0] as unknown as { merchant: Merchant } | undefined)?.merchant;
  return merchant ?? null;
}

export async function deleteSession(db: Db, tokenHash: Uint8Array): Promise<void> {
  await db.query("DELETE FROM session WHERE token_hash = $1", [tokenHash]);
}

// --- WebAuthn challenges ----------------------------------------------------------------

export type ChallengePurpose = "register" | "login" | "add_device" | "action";

export async function createChallenge(
  db: Db,
  c: { purpose: ChallengePurpose; challenge: string; expiresAt: Date; merchantId?: string | null; userHandle?: string | null; actionHash?: string | null },
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO webauthn_challenge (purpose, challenge, expires_at, merchant_id, user_handle, action_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [c.purpose, c.challenge, c.expiresAt, c.merchantId ?? null, c.userHandle ?? null, c.actionHash ?? null],
  );
  return row!.id;
}

/** Marks a challenge used and returns it, only if it is unused, unexpired and for this purpose. */
export async function consumeChallenge(
  db: Db,
  id: string,
  purpose: ChallengePurpose,
): Promise<{ challenge: string; merchant_id: string | null; user_handle: string | null; action_hash: string | null } | null> {
  const rows = await db.query<{ challenge: string; merchant_id: string | null; user_handle: string | null; action_hash: string | null }>(
    `UPDATE webauthn_challenge SET used_at = now()
     WHERE id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING challenge, merchant_id, user_handle, action_hash`,
    [id, purpose],
  );
  return rows[0] ?? null;
}

// --- email codes ------------------------------------------------------------------------

export async function createEmailCode(db: Db, merchantId: string, email: string, codeHash: Uint8Array, expiresAt: Date): Promise<void> {
  // A new code replaces any earlier one.
  await db.query("UPDATE email_code SET consumed_at = now() WHERE merchant_id = $1 AND consumed_at IS NULL", [merchantId]);
  await db.query("INSERT INTO email_code (merchant_id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)", [merchantId, email, codeHash, expiresAt]);
}

export async function latestEmailCode(db: Db, merchantId: string) {
  return (
    (
      await db.query<{ id: string; email: string; code_hash: Uint8Array; attempts: number; expires_at: Date }>(
        "SELECT id, email, code_hash, attempts, expires_at FROM email_code WHERE merchant_id = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [merchantId],
      )
    )[0] ?? null
  );
}

export async function recordEmailCodeAttempt(db: Db, id: string, consumed: boolean): Promise<void> {
  await db.query("UPDATE email_code SET attempts = attempts + 1, consumed_at = CASE WHEN $2 THEN now() ELSE consumed_at END WHERE id = $1", [id, consumed]);
}

// --- audit ------------------------------------------------------------------------------

export async function recordAudit(db: Db, merchantId: string | null, type: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query("INSERT INTO audit_event (merchant_id, type, detail) VALUES ($1, $2, $3)", [merchantId, type, JSON.stringify(detail)]);
}

export async function listAudit(db: Db, merchantId: string) {
  return db.query<{ type: string; detail: Record<string, unknown>; created_at: Date }>(
    "SELECT type, detail, created_at FROM audit_event WHERE merchant_id = $1 ORDER BY id",
    [merchantId],
  );
}

// --- rate limits ------------------------------------------------------------------------

/**
 * Counts one hit for `key` in a fixed window, atomically. Returns the count so far and when the
 * window resets. Expired windows restart at 1.
 */
export async function hitRateLimit(db: Db, key: string, windowMs: number): Promise<{ count: number; resetAt: Date }> {
  const [row] = await db.query<{ count: number; reset_at: Date }>(
    `INSERT INTO rate_limit (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2 / 1000.0))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit.reset_at <= now() THEN 1 ELSE rate_limit.count + 1 END,
       reset_at = CASE WHEN rate_limit.reset_at <= now() THEN now() + make_interval(secs => $2 / 1000.0) ELSE rate_limit.reset_at END
     RETURNING count, reset_at`,
    [key, windowMs],
  );
  return { count: row!.count, resetAt: new Date(row!.reset_at) };
}

export async function sweepRateLimits(db: Db): Promise<void> {
  await db.query("DELETE FROM rate_limit WHERE reset_at < now()");
}

// --- onboarding -------------------------------------------------------------------------

/** Merchant columns the onboarding screens may set. */
export type MerchantPatch = Partial<
  Pick<
    Merchant,
    | "handle"
    | "business_name"
    | "logo_url"
    | "country"
    | "payout_mode"
    | "payout_chain"
    | "payout_address"
    | "refund_policy_default"
    | "hold_by_default"
    | "confidential_default"
    | "sales_channels"
    | "onboarding_step"
  >
> & { terms_accepted_at?: Date; live_at?: Date };

const PATCHABLE = new Set([
  "handle",
  "business_name",
  "logo_url",
  "country",
  "payout_mode",
  "payout_chain",
  "payout_address",
  "refund_policy_default",
  "hold_by_default",
  "confidential_default",
  "sales_channels",
  "onboarding_step",
  "terms_accepted_at",
  "live_at",
]);

export async function updateMerchant(db: Db, id: string, patch: MerchantPatch): Promise<Merchant> {
  const entries = Object.entries(patch).filter(([k, v]) => PATCHABLE.has(k) && v !== undefined);
  if (entries.length === 0) return (await getMerchant(db, id))!;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const [row] = await db.query<Merchant>(`UPDATE merchant SET ${sets} WHERE id = $1 RETURNING *`, [id, ...entries.map(([, v]) => v)]);
  return row!;
}

export async function saveLogo(db: Db, merchantId: string, contentType: string, bytes: Uint8Array): Promise<void> {
  await db.query(
    `INSERT INTO merchant_logo (merchant_id, content_type, bytes) VALUES ($1, $2, $3)
     ON CONFLICT (merchant_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_at = now()`,
    [merchantId, contentType, bytes],
  );
}

export async function getLogo(db: Db, merchantId: string): Promise<{ content_type: string; bytes: Uint8Array } | null> {
  return (await db.query<{ content_type: string; bytes: Uint8Array }>("SELECT content_type, bytes FROM merchant_logo WHERE merchant_id = $1", [merchantId]))[0] ?? null;
}

/** A passkey added after sign-up: usable for login now, for money once the relayer registers it. */
export async function addPasskey(db: Db, merchantId: string, p: NewPasskey): Promise<Passkey> {
  const [row] = await db.query<Passkey>(
    `INSERT INTO passkey (merchant_id, credential_id, public_key, public_key_p256, sign_count, transports, backed_up, device_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [merchantId, p.credentialId, p.publicKey, p.publicKeyP256, p.signCount, p.transports, p.backedUp, p.deviceLabel ?? null],
  );
  await recordAudit(db, merchantId, "passkey.added", { credential_id: p.credentialId, first: false });
  return toPasskey(row!);
}

export async function markPasskeyRegistered(db: Db, merchantId: string, publicKeyP256: string): Promise<void> {
  await db.query("UPDATE passkey SET registered_on_verifier_at = now() WHERE merchant_id = $1 AND public_key_p256 = $2 AND removed_at IS NULL", [merchantId, publicKeyP256]);
}

export async function markPasskeyRemoved(db: Db, merchantId: string, publicKeyP256: string): Promise<void> {
  await db.query("UPDATE passkey SET removed_at = now() WHERE merchant_id = $1 AND public_key_p256 = $2 AND removed_at IS NULL", [merchantId, publicKeyP256]);
}

export async function recordRelayerSubmission(
  db: Db,
  s: { merchantId: string; intent: "add_public_key" | "remove_public_key"; publicKey: string; status: string; txHash?: string | null; error?: string | null },
): Promise<void> {
  await db.query("INSERT INTO relayer_submission (merchant_id, intent, public_key, status, tx_hash, error) VALUES ($1, $2, $3, $4, $5, $6)", [
    s.merchantId,
    s.intent,
    s.publicKey,
    s.status,
    s.txHash ?? null,
    s.error ?? null,
  ]);
}

// --- test payment -----------------------------------------------------------------------

export interface TestPayment {
  id: string;
  merchant_id: string;
  refund_address: string;
  deposit_address: string;
  amount_in: string;
  quote: Record<string, unknown>;
  status: string;
  received_amount: string | null;
  refund_deposit_address: string | null;
  refund_payload: string | null;
  refund_intent_hash: string | null;
  refund_status: string | null;
  created_at: Date;
}

export async function createTestPayment(
  db: Db,
  t: { merchantId: string; refundAddress: string; depositAddress: string; amountIn: string; quote: unknown },
): Promise<TestPayment> {
  const [row] = await db.query<TestPayment>(
    "INSERT INTO test_payment (merchant_id, refund_address, deposit_address, amount_in, quote) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [t.merchantId, t.refundAddress, t.depositAddress, t.amountIn, JSON.stringify(t.quote)],
  );
  return row!;
}

export async function latestTestPayment(db: Db, merchantId: string): Promise<TestPayment | null> {
  return (await db.query<TestPayment>("SELECT * FROM test_payment WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1", [merchantId]))[0] ?? null;
}

export async function updateTestPayment(
  db: Db,
  id: string,
  patch: Partial<Pick<TestPayment, "status" | "received_amount" | "refund_deposit_address" | "refund_payload" | "refund_intent_hash" | "refund_status">>,
): Promise<TestPayment> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const sets = [...entries.map(([k], i) => `${k} = $${i + 2}`), "updated_at = now()"].join(", ");
  const [row] = await db.query<TestPayment>(`UPDATE test_payment SET ${sets} WHERE id = $1 RETURNING *`, [id, ...entries.map(([, v]) => v)]);
  return row!;
}

// --- email and Google sign-in -----------------------------------------------------------

export async function findMerchantByVerifiedEmail(db: Db, email: string): Promise<Merchant | null> {
  return (
    (await db.query<Merchant>("SELECT * FROM merchant WHERE lower(contact_email) = lower($1) AND contact_email_verified_at IS NOT NULL", [email]))[0] ?? null
  );
}

export async function findMerchantByGoogleSub(db: Db, sub: string): Promise<Merchant | null> {
  return (await db.query<Merchant>("SELECT * FROM merchant WHERE google_sub = $1", [sub]))[0] ?? null;
}

/** A merchant who signed up with a verified email (from a code or from Google). No passkey yet. */
export async function createMerchantFromEmail(db: Db, email: string, googleSub: string | null = null): Promise<Merchant> {
  const [m] = await db.query<Merchant>(
    "INSERT INTO merchant (contact_email, contact_email_verified_at, google_sub) VALUES ($1, now(), $2) RETURNING *",
    [email, googleSub],
  );
  await recordAudit(db, m!.id, "merchant.created", { via: googleSub ? "google" : "email" });
  return m!;
}

export async function linkGoogle(db: Db, merchantId: string, sub: string): Promise<void> {
  await db.query("UPDATE merchant SET google_sub = $2 WHERE id = $1 AND google_sub IS NULL", [merchantId, sub]);
  await recordAudit(db, merchantId, "google.linked", {});
}

/**
 * The merchant's first passkey: it defines their NEAR Intents account. Fails if they already
 * have one (further devices go through add_public_key).
 */
export async function attachFirstPasskey(db: Db, merchantId: string, intentsAccountId: string, passkey: NewPasskey): Promise<Merchant> {
  return db.transaction(async tx => {
    const [m] = await tx.query<Merchant>(
      "UPDATE merchant SET intents_account_id = $2 WHERE id = $1 AND intents_account_id IS NULL RETURNING *",
      [merchantId, intentsAccountId],
    );
    if (!m) throw new Error("Merchant already has a passkey account");
    await tx.query(
      `INSERT INTO passkey (merchant_id, credential_id, public_key, public_key_p256, sign_count, transports, backed_up, device_label, registered_on_verifier_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [merchantId, passkey.credentialId, passkey.publicKey, passkey.publicKeyP256, passkey.signCount, passkey.transports, passkey.backedUp, passkey.deviceLabel ?? null],
    );
    await recordAudit(tx, merchantId, "passkey.added", { credential_id: passkey.credentialId, first: true });
    return m;
  });
}

export async function createLoginCode(db: Db, email: string, codeHash: Uint8Array, expiresAt: Date): Promise<void> {
  await db.query("UPDATE login_code SET consumed_at = now() WHERE lower(email) = lower($1) AND consumed_at IS NULL", [email]);
  await db.query("INSERT INTO login_code (email, code_hash, expires_at) VALUES ($1, $2, $3)", [email, codeHash, expiresAt]);
}

export async function latestLoginCode(db: Db, email: string) {
  return (
    (
      await db.query<{ id: string; code_hash: Uint8Array; attempts: number; expires_at: Date }>(
        "SELECT id, code_hash, attempts, expires_at FROM login_code WHERE lower(email) = lower($1) AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [email],
      )
    )[0] ?? null
  );
}

export async function recordLoginCodeAttempt(db: Db, id: string, consumed: boolean): Promise<void> {
  await db.query("UPDATE login_code SET attempts = attempts + 1, consumed_at = CASE WHEN $2 THEN now() ELSE consumed_at END WHERE id = $1", [id, consumed]);
}

export async function createOAuthState(db: Db, state: string, codeVerifier: string, expiresAt: Date): Promise<void> {
  await db.query("INSERT INTO oauth_state (state, code_verifier, expires_at) VALUES ($1, $2, $3)", [state, codeVerifier, expiresAt]);
}

export async function consumeOAuthState(db: Db, state: string): Promise<string | null> {
  const rows = await db.query<{ code_verifier: string }>(
    "UPDATE oauth_state SET used_at = now() WHERE state = $1 AND used_at IS NULL AND expires_at > now() RETURNING code_verifier",
    [state],
  );
  return rows[0]?.code_verifier ?? null;
}
