// Onboarding endpoints: autosave for each screen, the backup device (via the relayer), the $2
// test payment with its passkey-signed refund, and going live.
import type { Context, Hono } from "hono";
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import {
  addPasskey,
  consumeChallenge,
  createChallenge,
  createTestPayment,
  findPasskeyByCredentialId,
  getLogo,
  isHandleTaken,
  latestTestPayment,
  listPasskeys,
  markPasskeyRegistered,
  markPasskeyRemoved,
  recordAudit,
  recordRelayerSubmission,
  saveLogo,
  updateMerchant,
  updateTestPayment,
  type Db,
  type Merchant,
  type MerchantPatch,
  type TestPayment,
} from "@morva/database";
import { canAdvance, canGoLive, isOnboardingStep, normalizeHandle, ONBOARDING_STEPS, validateHandle, validatePayoutAddress, type OnboardingStep } from "@morva/domain";
import { createTokenCatalog, currentSalt, IntentsError, p256PublicKeyString, rawP256FromCoordinates, type OneClickClient } from "@morva/intents";
import type { Config } from "./config.ts";
import { checkKeyIntent, type Relayer } from "./relayer.ts";
import type { LIMITS } from "./rate-limit.ts";

type Env = { Variables: { merchant: Merchant; ip: string } };
type Limiter = (c: Context<Env>, name: keyof typeof LIMITS, key: string) => Promise<Response | null>;

export interface OnboardingDeps {
  db: Db;
  config: Config;
  limit: Limiter;
  requireMerchant: (c: Context<Env>, next: () => Promise<void>) => Promise<Response | void>;
  publicMerchant: (m: Merchant) => Record<string, unknown>;
  relayer: Relayer | null;
  oneclick: OneClickClient | null;
  verifierRpcUrl?: string;
}

const ES256 = -7;
const CHALLENGE_TTL_MS = 5 * 60_000;
const SALES_CHANNELS = ["payment_links", "events", "shopify", "woocommerce", "own_site"];
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_MAX = 256 * 1024;
const TEST_AMOUNT = 2_000_000n; // $2 in USDC smallest units
const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

const stepState = (m: Merchant) => ({
  handle: m.handle,
  business_name: m.business_name,
  country: m.country,
  contact_email_verified: Boolean(m.contact_email_verified_at),
  terms_accepted: Boolean(m.terms_accepted_at),
  has_passkey: Boolean(m.intents_account_id),
  onboarding_step: m.onboarding_step,
  live: Boolean(m.live_at),
});

export function registerOnboarding(app: Hono<Env>, d: OnboardingDeps) {
  const { db, config, limit, requireMerchant, publicMerchant } = d;
  const guard = async (c: Context<Env>) => limit(c, "onboarding", c.get("merchant").id);
  const body = async <T>(c: Context<Env>) => (await c.req.json<T>().catch(() => ({}) as T)) ?? ({} as T);
  const saved = (c: Context<Env>, m: Merchant) => c.json({ merchant: publicMerchant(m) });

  // --- autosave, one screen at a time ---------------------------------------------------

  app.patch("/v1/onboarding/business", requireMerchant, async c => {
    const limited = await guard(c);
    if (limited) return limited;
    const merchant = c.get("merchant");
    const b = await body<{ business_name?: string; handle?: string; country?: string }>(c);
    const patch: MerchantPatch = {};
    if (b.business_name !== undefined) {
      const name = String(b.business_name).trim();
      if (name.length > 120) return c.json({ error: "invalid", field: "business_name", message: "Use 120 characters or fewer." }, 400);
      patch.business_name = name || null;
    }
    if (b.handle !== undefined) {
      const handle = normalizeHandle(String(b.handle));
      const valid = validateHandle(handle);
      if (!valid.ok) return c.json({ error: "invalid", field: "handle", message: valid.message }, 400);
      if (await isHandleTaken(db, handle, merchant.id)) return c.json({ error: "taken", field: "handle", message: "That name is taken. Try another." }, 409);
      patch.handle = handle;
    }
    if (b.country !== undefined) {
      const country = String(b.country).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return c.json({ error: "invalid", field: "country", message: "Choose your country." }, 400);
      patch.country = country;
    }
    return saved(c, await updateMerchant(db, merchant.id, patch));
  });

  app.post("/v1/onboarding/logo", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await limit(c, "logo", merchant.id);
    if (limited) return limited;
    const type = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
    if (!LOGO_TYPES.has(type)) return c.json({ error: "invalid", message: "Use a PNG, JPEG or WebP image." }, 415);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0 || bytes.length > LOGO_MAX) return c.json({ error: "invalid", message: "Use an image under 256 KB." }, 413);
    await saveLogo(db, merchant.id, type, bytes);
    return saved(c, await updateMerchant(db, merchant.id, { logo_url: `/api/v1/logos/${merchant.id}?v=${Date.now()}` }));
  });

  app.get("/v1/logos/:id", async c => {
    const logo = /^[0-9a-f-]{36}$/.test(c.req.param("id")) ? await getLogo(db, c.req.param("id")) : null;
    if (!logo) return c.body(null, 404);
    return c.body(Buffer.from(logo.bytes), 200, {
      "Content-Type": logo.content_type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.patch("/v1/onboarding/payout", requireMerchant, async c => {
    const limited = await guard(c);
    if (limited) return limited;
    const merchant = c.get("merchant");
    // Once live, payout changes need a passkey signature (dashboard settings, Step 4).
    if (merchant.live_at) return c.json({ error: "signature_required", message: "Change payouts in Settings, with your passkey." }, 409);
    const b = await body<{ mode?: string; chain?: string; address?: string }>(c);
    if (b.mode === "keep_in_balance") {
      return saved(c, await updateMerchant(db, merchant.id, { payout_mode: "keep_in_balance", payout_chain: null, payout_address: null }));
    }
    if (b.mode !== "auto_payout") return c.json({ error: "invalid", field: "mode", message: "Choose how you get paid." }, 400);
    const check = validatePayoutAddress(String(b.chain ?? ""), String(b.address ?? ""));
    if (!check.ok) return c.json({ error: "invalid", field: "address", message: check.message }, 400);
    return saved(c, await updateMerchant(db, merchant.id, { payout_mode: "auto_payout", payout_chain: String(b.chain), payout_address: check.address }));
  });

  app.patch("/v1/onboarding/channels", requireMerchant, async c => {
    const limited = await guard(c);
    if (limited) return limited;
    const b = await body<{ channels?: unknown }>(c);
    const channels = Array.isArray(b.channels) ? [...new Set(b.channels.map(String))] : [];
    if (channels.length === 0 || channels.some(ch => !SALES_CHANNELS.includes(ch))) {
      return c.json({ error: "invalid", field: "channels", message: "Pick at least one way you sell." }, 400);
    }
    return saved(c, await updateMerchant(db, c.get("merchant").id, { sales_channels: channels }));
  });

  app.patch("/v1/onboarding/defaults", requireMerchant, async c => {
    const limited = await guard(c);
    if (limited) return limited;
    const b = await body<{ hold_by_default?: unknown; refund_policy_default?: unknown; confidential_default?: unknown }>(c);
    const patch: MerchantPatch = {};
    if (b.hold_by_default !== undefined) patch.hold_by_default = b.hold_by_default === true;
    if (b.confidential_default !== undefined) patch.confidential_default = b.confidential_default === true;
    if (b.refund_policy_default !== undefined) {
      if (b.refund_policy_default !== "full_to_source" && b.refund_policy_default !== "none") return c.json({ error: "invalid", field: "refund_policy_default" }, 400);
      patch.refund_policy_default = b.refund_policy_default;
    }
    return saved(c, await updateMerchant(db, c.get("merchant").id, patch));
  });

  app.post("/v1/onboarding/terms", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const b = await body<{ accept?: unknown }>(c);
    if (b.accept !== true) return c.json({ error: "invalid", message: "Accept the terms to continue." }, 400);
    await recordAudit(db, merchant.id, "terms.accepted", {});
    return saved(c, await updateMerchant(db, merchant.id, { terms_accepted_at: new Date() }));
  });

  // Progress: the server stores the furthest step reached, so a merchant resumes there.
  app.post("/v1/onboarding/step", requireMerchant, async c => {
    const limited = await guard(c);
    if (limited) return limited;
    const merchant = c.get("merchant");
    const b = await body<{ from?: string; skip?: boolean }>(c);
    if (!b.from || !isOnboardingStep(b.from)) return c.json({ error: "invalid", message: "Unknown step." }, 400);
    const reached: OnboardingStep = isOnboardingStep(merchant.onboarding_step) ? merchant.onboarding_step : "business";
    if (ONBOARDING_STEPS.indexOf(b.from) > ONBOARDING_STEPS.indexOf(reached)) return c.json({ error: "out_of_order", message: "Finish the earlier steps first." }, 409);
    const r = canAdvance(stepState(merchant), b.from, { skip: b.skip === true });
    if (!r.ok) return c.json({ error: "incomplete", message: r.message }, 409);
    if (b.skip) await recordAudit(db, merchant.id, "onboarding.skipped", { step: b.from });
    const furthest = ONBOARDING_STEPS.indexOf(r.to) > ONBOARDING_STEPS.indexOf(reached) ? r.to : reached;
    return c.json({ step: r.to, merchant: publicMerchant(await updateMerchant(db, merchant.id, { onboarding_step: furthest })) });
  });

  app.post("/v1/onboarding/live", requireMerchant, async c => {
    const merchant = c.get("merchant");
    if (merchant.live_at) return saved(c, merchant);
    const r = canGoLive(stepState(merchant));
    if (!r.ok) return c.json({ error: "incomplete", message: r.message }, 409);
    await recordAudit(db, merchant.id, "merchant.live", {});
    return saved(c, await updateMerchant(db, merchant.id, { live_at: new Date(), onboarding_step: "live" }));
  });

  // --- backup device -------------------------------------------------------------------

  app.post("/v1/me/passkeys/options", requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await limit(c, "addDevice", merchant.id);
    if (limited) return limited;
    const existing = await listPasskeys(db, merchant.id);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: merchant.business_name || "Morva merchant",
      userDisplayName: merchant.business_name || "Morva merchant",
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [ES256],
      excludeCredentials: existing.map(p => ({ id: p.credential_id, transports: p.transports })),
    });
    const challengeId = await createChallenge(db, { purpose: "add_device", challenge: options.challenge, merchantId: merchant.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
    return c.json({ challengeId, options });
  });

  app.post("/v1/me/passkeys/verify", requireMerchant, async c => {
    const merchant = c.get("merchant");
    if (!hasAccount(merchant)) return noPasskey(c);
    const limited = await limit(c, "addDevice", merchant.id);
    if (limited) return limited;
    const b = await body<{ challengeId?: string; response?: RegistrationResponseJSON; deviceLabel?: string }>(c);
    if (!b.challengeId || !b.response) return c.json({ error: "invalid_request" }, 400);
    const challenge = await consumeChallenge(db, b.challengeId, "add_device");
    if (!challenge || challenge.merchant_id !== merchant.id) return c.json({ error: "challenge_expired" }, 400);
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: b.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [ES256],
      });
    } catch {
      return c.json({ error: "passkey_rejected" }, 400);
    }
    if (!v.verified) return c.json({ error: "passkey_rejected" }, 400);
    const key = decodeCredentialPublicKey(v.registrationInfo.credential.publicKey);
    const x = key.get(cose.COSEKEYS.x as never) as Uint8Array | undefined;
    const y = key.get(cose.COSEKEYS.y as never) as Uint8Array | undefined;
    if (!x || !y) return c.json({ error: "unsupported_key" }, 400);
    if (await findPasskeyByCredentialId(db, v.registrationInfo.credential.id)) return c.json({ error: "passkey_exists" }, 409);
    const pk = await addPasskey(db, merchant.id, {
      credentialId: v.registrationInfo.credential.id,
      publicKey: v.registrationInfo.credential.publicKey,
      publicKeyP256: p256PublicKeyString(rawP256FromCoordinates(x, y)),
      signCount: v.registrationInfo.credential.counter,
      transports: v.registrationInfo.credential.transports ?? [],
      backedUp: v.registrationInfo.credentialBackedUp,
      deviceLabel: b.deviceLabel?.slice(0, 60) ?? null,
    });
    // The browser next asks an existing passkey to sign add_public_key for this key.
    const signers = (await listPasskeys(db, merchant.id)).filter(p => p.registered_on_verifier_at);
    return c.json({
      passkey: { id: pk.id, public_key_p256: pk.public_key_p256 },
      signers: signers.map(p => ({ credential_id: p.credential_id, public_key_p256: p.public_key_p256, transports: p.transports })),
      intents_account_id: merchant.intents_account_id,
    });
  });

  let saltCache: { value: string; at: number } | null = null;
  app.get("/v1/intents/salt", requireMerchant, async c => {
    if (!saltCache || Date.now() - saltCache.at > 30_000) saltCache = { value: await currentSalt({ rpcUrl: d.verifierRpcUrl }), at: Date.now() };
    return c.json({ salt: saltCache.value });
  });

  app.post("/v1/relayer/key-intents", requireMerchant, async c => {
    const merchant = c.get("merchant");
    if (!hasAccount(merchant)) return noPasskey(c);
    if (!d.relayer) return c.json({ error: "relayer_unavailable", message: "Adding a device isn't available right now. You can skip this and add one later." }, 503);
    const limited = await limit(c, "relayer", merchant.id);
    if (limited) return limited;
    const b = await body<{ signed?: unknown }>(c);
    const check = checkKeyIntent(b.signed, merchant, await listPasskeys(db, merchant.id));
    if (!check.ok) return c.json({ error: check.error, message: check.message }, 400);

    const sim = await d.relayer.simulate(check.signed);
    if (!sim.ok) {
      await recordRelayerSubmission(db, { merchantId: merchant.id, intent: check.intent, publicKey: check.publicKey, status: "rejected", error: sim.error });
      return c.json({ error: "simulation_failed", message: "Your passkey's signature wasn't accepted. Try again.", detail: sim.error }, 422);
    }
    const { txHash } = await d.relayer.submit(check.signed);
    await recordRelayerSubmission(db, { merchantId: merchant.id, intent: check.intent, publicKey: check.publicKey, status: "submitted", txHash });
    if (check.intent === "add_public_key") await markPasskeyRegistered(db, merchant.id, check.publicKey);
    else await markPasskeyRemoved(db, merchant.id, check.publicKey);
    await recordAudit(db, merchant.id, check.intent === "add_public_key" ? "passkey.registered" : "passkey.removed", { public_key: check.publicKey, tx_hash: txHash });
    return c.json({ tx_hash: txHash });
  });

  // --- the $2 test payment ----------------------------------------------------------------

  const catalog = d.oneclick ? createTokenCatalog(d.oneclick) : null;
  /** 1Click outages or rejections become a plain, skippable message instead of a 500. */
  const oneclickDown = (c: Context<Env>, error: unknown) => {
    if (!(error instanceof IntentsError)) throw error;
    console.warn(`[test payment] 1Click ${error.kind} ${error.status ?? ""}: ${error.message.slice(0, 160)}`);
    return c.json({ error: "unavailable", message: "Test payments aren’t available right now. You can skip this step and try later from your dashboard." }, 503);
  };
  const oneclickOrFail = (c: Context<Env>) =>
    d.oneclick && catalog ? null : c.json({ error: "unavailable", message: "Test payments aren't available right now. You can skip this step." }, 503);

  const testPaymentView = (t: TestPayment) => ({
    deposit_address: t.deposit_address,
    amount_in: t.amount_in,
    refund_address: t.refund_address,
    status: t.status,
    received_amount: t.received_amount,
    refund_status: t.refund_status,
    refunded: t.refund_status === "SUCCESS",
  });

  app.post("/v1/onboarding/test-payment", requireMerchant, async c => {
    try {
      const unavailable = oneclickOrFail(c);
      if (unavailable) return unavailable;
      const merchant = c.get("merchant");
    if (!hasAccount(merchant)) return noPasskey(c);
      const limited = await limit(c, "testPayment", merchant.id);
      if (limited) return limited;
      const b = await body<{ refund_address?: string }>(c);
      const refund = validatePayoutAddress("base", String(b.refund_address ?? ""));
      if (!refund.ok) return c.json({ error: "invalid", field: "refund_address", message: refund.message }, 400);
      const [baseUsdc, nearUsdc] = await Promise.all([catalog!.find("base", "USDC"), catalog!.find("near", "USDC")]);
      const q = await d.oneclick!.quote({
        dry: false,
        swapType: "EXACT_OUTPUT",
        originAsset: baseUsdc.assetId,
        destinationAsset: nearUsdc.assetId,
        amount: TEST_AMOUNT,
        depositType: "ORIGIN_CHAIN",
        refundTo: refund.address,
        recipient: merchant.intents_account_id,
        recipientType: "INTENTS",
        deadline: new Date(Date.now() + 30 * 60_000),
      });
      const t = await createTestPayment(db, {
        merchantId: merchant.id,
        refundAddress: refund.address,
        depositAddress: q.quote.depositAddress!,
        amountIn: q.quote.amountIn.toString(),
        quote: q.raw,
      });
      await recordAudit(db, merchant.id, "test_payment.created", { deposit_address: t.deposit_address });
      return c.json({ test_payment: testPaymentView(t) }, 201);
    } catch (error) {
      return oneclickDown(c, error);
    }
  });

  app.get("/v1/onboarding/test-payment", requireMerchant, async c => {
    const merchant = c.get("merchant");
    let t = await latestTestPayment(db, merchant.id);
    if (!t) return c.json({ test_payment: null });
    if (d.oneclick && !TERMINAL.has(t.status)) {
      const s = await d.oneclick.getStatus(t.deposit_address).catch(() => null);
      if (s && s.status !== t.status) {
        t = await updateTestPayment(db, t.id, { status: s.status, received_amount: s.swapDetails.amountOut?.toString() ?? null });
      }
    }
    if (d.oneclick && t.refund_deposit_address && t.refund_status && !TERMINAL.has(t.refund_status)) {
      const s = await d.oneclick.getStatus(t.refund_deposit_address).catch(() => null);
      if (s && s.status !== t.refund_status) t = await updateTestPayment(db, t.id, { refund_status: s.status });
    }
    return c.json({ test_payment: testPaymentView(t) });
  });

  // Refund step 1: Morva gets 1Click's intent for the refund; the merchant's passkey signs it.
  app.post("/v1/onboarding/test-payment/refund", requireMerchant, async c => {
    try {
      const unavailable = oneclickOrFail(c);
      if (unavailable) return unavailable;
      const merchant = c.get("merchant");
    if (!hasAccount(merchant)) return noPasskey(c);
      const limited = await limit(c, "testPayment", merchant.id);
      if (limited) return limited;
      const t = await latestTestPayment(db, merchant.id);
      if (!t || t.status !== "SUCCESS" || !t.received_amount) return c.json({ error: "not_ready", message: "The test payment hasn't arrived yet." }, 409);
      if (t.refund_intent_hash) return c.json({ error: "already_refunded", message: "This test payment is already refunded." }, 409);
      const [baseUsdc, nearUsdc] = await Promise.all([catalog!.find("base", "USDC"), catalog!.find("near", "USDC")]);
      const q = await d.oneclick!.quote({
        dry: false,
        swapType: "EXACT_INPUT",
        originAsset: nearUsdc.assetId,
        destinationAsset: baseUsdc.assetId,
        amount: BigInt(t.received_amount),
        depositType: "INTENTS",
        refundTo: merchant.intents_account_id,
        recipient: t.refund_address,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 15 * 60_000),
      });
      const gen = await d.oneclick!.generateIntent({ standard: "webauthn", signerId: merchant.intents_account_id, depositAddress: q.quote.depositAddress! });
      await updateTestPayment(db, t.id, { refund_deposit_address: q.quote.depositAddress!, refund_payload: gen.intent.payload });
      const signers = (await listPasskeys(db, merchant.id)).filter(p => p.registered_on_verifier_at);
      return c.json({
        payload: gen.intent.payload,
        refund_amount_out: q.quote.amountOut.toString(),
        signers: signers.map(p => ({ credential_id: p.credential_id, public_key_p256: p.public_key_p256, transports: p.transports })),
      });
    } catch (error) {
      return oneclickDown(c, error);
    }
  });

  // Refund step 2: the signed intent goes to 1Click exactly as signed.
  app.post("/v1/onboarding/test-payment/refund/submit", requireMerchant, async c => {
    try {
      const unavailable = oneclickOrFail(c);
      if (unavailable) return unavailable;
      const merchant = c.get("merchant");
    if (!hasAccount(merchant)) return noPasskey(c);
      const t = await latestTestPayment(db, merchant.id);
      const b = await body<{ signed?: Record<string, unknown> }>(c);
      const s = b.signed;
      if (!t?.refund_payload || !s || s.standard !== "webauthn") return c.json({ error: "invalid_request" }, 400);
      // The merchant must have signed exactly the payload 1Click generated.
      if (s.payload !== t.refund_payload) return c.json({ error: "payload_mismatch", message: "That isn't the refund you were asked to sign." }, 400);
      const signers = (await listPasskeys(db, merchant.id)).filter(p => p.registered_on_verifier_at);
      if (!signers.some(p => p.public_key_p256 === s.public_key)) return c.json({ error: "unknown_signer" }, 400);
      const r = await d.oneclick!.submitIntent({
        standard: "webauthn",
        payload: String(s.payload),
        public_key: String(s.public_key),
        signature: String(s.signature),
        client_data_json: String(s.client_data_json),
        authenticator_data: String(s.authenticator_data),
      });
      await updateTestPayment(db, t.id, { refund_intent_hash: r.intentHash, refund_status: "PROCESSING" });
      await recordAudit(db, merchant.id, "test_payment.refunded", { intent_hash: r.intentHash, to: t.refund_address });
      return c.json({ intent_hash: r.intentHash });
    } catch (error) {
      return oneclickDown(c, error);
    }
  });
}

/** A merchant whose passkey account exists. Email and Google sign-ups have none until "secure". */
function hasAccount(m: Merchant): m is Merchant & { intents_account_id: string } {
  return m.intents_account_id !== null;
}

function noPasskey(c: Context) {
  return c.json({ error: "no_passkey", message: "Create your passkey first: it holds your balance." }, 409);
}
