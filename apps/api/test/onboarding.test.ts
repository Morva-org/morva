import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAudit } from "@morva/database";
import { keyIntentPayload, payloadChallenge, webauthnSignedIntent, type OneClickClient, type Token } from "@morva/intents";
import type { Relayer, SignedKeyIntent } from "../src/relayer.ts";
import { setup } from "./helpers.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";
import { config } from "./helpers.ts";

const BASE = "0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE";

async function verifiedMerchant(env: Awaited<ReturnType<typeof setup>>) {
  const m = await env.merchant();
  await m.c.call("PATCH", "/v1/onboarding/business", { business_name: "Northside Events", handle: "northside", country: "ng" });
  await m.c.call("POST", "/v1/me/email", { email: "owner@northside.example" });
  await m.c.call("POST", "/v1/me/email/verify", { code: env.sent.at(-1)!.code });
  return m;
}

describe("autosave", () => {
  it("saves each business field as it is typed, with validation", async () => {
    const env = await setup();
    const { c } = await env.merchant();
    let r = await c.call("PATCH", "/v1/onboarding/business", { business_name: "  Northside Events " });
    assert.equal(r.body.merchant.business_name, "Northside Events");
    r = await c.call("PATCH", "/v1/onboarding/business", { handle: "Northside" });
    assert.equal(r.body.merchant.handle, "northside");
    r = await c.call("PATCH", "/v1/onboarding/business", { handle: "no" });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "handle");
    r = await c.call("PATCH", "/v1/onboarding/business", { country: "ng" });
    assert.equal(r.body.merchant.country, "NG");

    const other = await env.merchant();
    assert.equal((await other.c.call("PATCH", "/v1/onboarding/business", { handle: "northside" })).status, 409);
    await env.close();
  });

  it("stores payout, channels and order defaults", async () => {
    const env = await setup();
    const { c } = await env.merchant();
    assert.equal((await c.call("PATCH", "/v1/onboarding/payout", { mode: "auto_payout", chain: "base", address: "0x123" })).status, 400);
    assert.equal((await c.call("PATCH", "/v1/onboarding/payout", { mode: "auto_payout", chain: "tron", address: "T1" })).status, 400);
    let r = await c.call("PATCH", "/v1/onboarding/payout", { mode: "auto_payout", chain: "base", address: BASE });
    assert.equal(r.body.merchant.payout_mode, "auto_payout");
    assert.equal(r.body.merchant.payout_address, BASE);
    r = await c.call("PATCH", "/v1/onboarding/payout", { mode: "keep_in_balance" });
    assert.equal(r.body.merchant.payout_mode, "keep_in_balance");
    assert.equal(r.body.merchant.payout_address, null);

    assert.equal((await c.call("PATCH", "/v1/onboarding/channels", { channels: [] })).status, 400);
    assert.equal((await c.call("PATCH", "/v1/onboarding/channels", { channels: ["tiktok"] })).status, 400);
    r = await c.call("PATCH", "/v1/onboarding/channels", { channels: ["payment_links", "events", "events"] });
    assert.deepEqual(r.body.merchant.sales_channels, ["payment_links", "events"]);

    r = await c.call("PATCH", "/v1/onboarding/defaults", { hold_by_default: true, refund_policy_default: "none", confidential_default: true });
    assert.equal(r.body.merchant.hold_by_default, true);
    assert.equal(r.body.merchant.refund_policy_default, "none");
    assert.equal((await c.call("PATCH", "/v1/onboarding/defaults", { refund_policy_default: "maybe" })).status, 400);
    await env.close();
  });

  it("accepts a small PNG, JPEG or WebP logo and serves it safely", async () => {
    const env = await setup();
    const { c, merchant } = await env.merchant();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    assert.equal((await c.call("POST", "/v1/onboarding/logo", png, { "content-type": "image/svg+xml" })).status, 415);
    assert.equal((await c.call("POST", "/v1/onboarding/logo", new Uint8Array(300_000), { "content-type": "image/png" })).status, 413);
    const r = await c.call("POST", "/v1/onboarding/logo", png, { "content-type": "image/png" });
    assert.match(r.body.merchant.logo_url, new RegExp(`^/api/v1/logos/${merchant.id}`));
    const res = await env.app.request(`/v1/logos/${merchant.id}`);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);
    await env.close();
  });
});

describe("progress and resume", () => {
  it("moves forward only when a step is complete, and stores the furthest step", async () => {
    const env = await setup();
    const { c } = await env.merchant();
    let r = await c.call("POST", "/v1/onboarding/step", { from: "business" });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /business name/);
    await c.call("PATCH", "/v1/onboarding/business", { business_name: "Northside", handle: "northside", country: "NG" });
    r = await c.call("POST", "/v1/onboarding/step", { from: "business" });
    assert.equal(r.body.step, "email");
    assert.equal(r.body.merchant.onboarding_step, "email");

    assert.equal((await c.call("POST", "/v1/onboarding/step", { from: "email", skip: true })).status, 409, "email can't be skipped");
    assert.equal((await c.call("POST", "/v1/onboarding/step", { from: "terms" })).status, 409, "can't jump ahead");

    // Going back and continuing from an earlier step doesn't lose the furthest step reached.
    r = await c.call("POST", "/v1/onboarding/step", { from: "business" });
    assert.equal(r.body.step, "email");
    assert.equal(r.body.merchant.onboarding_step, "email");

    // A new session (closed tab, another day) resumes from the stored step.
    const me = await c.call("GET", "/v1/me");
    assert.equal(me.body.merchant.onboarding_step, "email");
    await env.close();
  });

  it("lets the backup device and the test payment be skipped, and audits it", async () => {
    const env = await setup();
    const { c, merchant } = await verifiedMerchant(env);
    for (const from of ["business", "email", "payout", "channels", "defaults"]) assert.equal((await c.call("POST", "/v1/onboarding/step", { from })).status, 200, from);
    const r = await c.call("POST", "/v1/onboarding/step", { from: "backup", skip: true });
    assert.equal(r.body.step, "terms");
    assert.ok((await listAudit(env.db, merchant.id)).some(a => a.type === "onboarding.skipped" && a.detail.step === "backup"));
    await env.close();
  });

  it("goes live only after terms, and then locks payout changes behind a signature", async () => {
    const env = await setup();
    const { c } = await verifiedMerchant(env);
    assert.equal((await c.call("POST", "/v1/onboarding/live")).status, 409);
    assert.equal((await c.call("POST", "/v1/onboarding/terms", { accept: false })).status, 400);
    await c.call("POST", "/v1/onboarding/terms", { accept: true });
    const live = await c.call("POST", "/v1/onboarding/live");
    assert.equal(live.body.merchant.live, true);
    assert.equal(live.body.merchant.onboarding_step, "live");
    const payout = await c.call("PATCH", "/v1/onboarding/payout", { mode: "keep_in_balance" });
    assert.equal(payout.status, 409);
    assert.equal(payout.body.error, "signature_required");
    await env.close();
  });
});

/** A relayer double that records what it was given, so tests can check it changed nothing. */
function fakeRelayer(simulation: Awaited<ReturnType<Relayer["simulate"]>> = { ok: true, logs: ["public_key_added"] }) {
  const simulated: SignedKeyIntent[] = [];
  const submitted: SignedKeyIntent[] = [];
  const relayer: Relayer = {
    simulate: async s => (simulated.push(s), simulation),
    submit: async s => (submitted.push(s), { txHash: "TxHash111" }),
  };
  return { relayer, simulated, submitted };
}

/** Adds a second passkey and returns what the browser would sign with the first. */
async function addSecondDevice(env: Awaited<ReturnType<typeof setup>>) {
  const m = await env.merchant();
  const backup = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin });
  const opts = await m.c.call("POST", "/v1/me/passkeys/options");
  assert.deepEqual(opts.body.options.excludeCredentials.map((x: { id: string }) => x.id), [m.auth.id], "won't register the same device twice");
  const added = await m.c.call("POST", "/v1/me/passkeys/verify", { challengeId: opts.body.challengeId, response: backup.register(opts.body.options), deviceLabel: "Phone" });
  assert.equal(added.status, 200);
  const sign = async (payload: string, signer = m.auth) => {
    const assertion = signer.authenticate(await payloadChallenge(payload));
    return webauthnSignedIntent({ payload, publicKeyP256: added.body.signers[0].public_key_p256, assertion: assertion.response });
  };
  return { ...m, backup, added: added.body, sign };
}

describe("backup device and the relayer", () => {
  it("registers the second passkey by submitting the first passkey's signed intent unchanged", async () => {
    const fake = fakeRelayer();
    const env = await setup({ relayer: fake.relayer });
    const { c, added, sign, merchant } = await addSecondDevice(env);
    const payload = keyIntentPayload({ signerId: added.intents_account_id, intent: "add_public_key", publicKey: added.passkey.public_key_p256, salt: "252812b3" });
    const signed = await sign(payload);
    const r = await c.call("POST", "/v1/relayer/key-intents", { signed });
    assert.equal(r.status, 200);
    assert.equal(r.body.tx_hash, "TxHash111");
    assert.deepEqual(fake.simulated, [signed], "simulated exactly what was signed");
    assert.deepEqual(fake.submitted, [signed], "submitted exactly what was signed");
    const me = await c.call("GET", "/v1/me");
    assert.equal(me.body.passkeys.length, 2);
    assert.ok((await listAudit(env.db, merchant.id)).some(a => a.type === "passkey.registered"));
    await env.close();
  });

  it("refuses anything that isn't the merchant's own key change, before simulating", async () => {
    const fake = fakeRelayer();
    const env = await setup({ relayer: fake.relayer });
    const { c, added, sign } = await addSecondDevice(env);
    const base = { signerId: added.intents_account_id, publicKey: added.passkey.public_key_p256, salt: "252812b3" };
    const cases: [string, () => Promise<unknown>][] = [
      ["another account", async () => sign(keyIntentPayload({ ...base, signerId: "0x" + "1".repeat(40), intent: "add_public_key" }))],
      [
        "a transfer",
        async () =>
          sign(JSON.stringify({ signer_id: base.signerId, verifying_contract: "intents.near", deadline: new Date(Date.now() + 60_000).toISOString(), nonce: "x", intents: [{ intent: "transfer", receiver_id: "x.near", tokens: {} }] })),
      ],
      ["removing the only registered device", async () => sign(keyIntentPayload({ ...base, intent: "remove_public_key", publicKey: added.signers[0].public_key_p256 }))],
      ["an unknown key", async () => sign(keyIntentPayload({ ...base, intent: "add_public_key", publicKey: "p256:Unknown" }))],
      ["extra fields", async () => ({ ...(await sign(keyIntentPayload({ ...base, intent: "add_public_key" }))), relayer_note: "x" })],
      ["another standard", async () => ({ ...(await sign(keyIntentPayload({ ...base, intent: "add_public_key" }))), standard: "nep413" })],
    ];
    for (const [name, make] of cases) {
      const r = await c.call("POST", "/v1/relayer/key-intents", { signed: await make() });
      assert.equal(r.status, 400, name);
    }
    assert.equal(fake.simulated.length, 0);
    assert.equal(fake.submitted.length, 0);
    await env.close();
  });

  it("doesn't submit when simulation fails", async () => {
    const fake = fakeRelayer({ ok: false, error: "invalid signature" });
    const env = await setup({ relayer: fake.relayer });
    const { c, added, sign } = await addSecondDevice(env);
    const r = await c.call("POST", "/v1/relayer/key-intents", {
      signed: await sign(keyIntentPayload({ signerId: added.intents_account_id, intent: "add_public_key", publicKey: added.passkey.public_key_p256, salt: "252812b3" })),
    });
    assert.equal(r.status, 422);
    assert.equal(fake.submitted.length, 0);
    await env.close();
  });

  it("says so plainly when the relayer isn't configured", async () => {
    const env = await setup();
    const { c } = await env.merchant();
    const r = await c.call("POST", "/v1/relayer/key-intents", { signed: {} });
    assert.equal(r.status, 503);
    assert.match(r.body.message, /skip/);
    await env.close();
  });
});

/** A 1Click double: one Base deposit that settles, then a refund intent to sign. */
function fakeOneClick() {
  const tokens: Token[] = [
    { assetId: "nep141:base-usdc", blockchain: "base", symbol: "USDC", decimals: 6, contractAddress: "0x8335", price: 10n ** 18n, priceUpdatedAt: new Date() },
    { assetId: "nep141:near-usdc", blockchain: "near", symbol: "USDC", decimals: 6, contractAddress: "17208628", price: 10n ** 18n, priceUpdatedAt: new Date() },
  ];
  const calls: { quotes: unknown[]; submitted: unknown[] } = { quotes: [], submitted: [] };
  let status = "PENDING_DEPOSIT";
  const quoteResult = (deposit: string, amountIn: bigint, amountOut: bigint) => ({
    correlationId: "c",
    signature: "s",
    timestamp: new Date(),
    raw: {},
    quote: { depositAddress: deposit, depositMemo: null, amountIn, minAmountIn: amountIn, amountOut, minAmountOut: amountOut, amountInUsd: 0n, amountOutUsd: 0n, deadline: null, timeEstimateSeconds: 30, refundFee: null, withdrawFee: null },
  });
  const client: OneClickClient = {
    getTokens: async () => tokens,
    quote: async p => {
      calls.quotes.push(p);
      return p.depositType === "ORIGIN_CHAIN" ? quoteResult("0xdeposit", 2_004_000n, 2_000_000n) : quoteResult("refund-deposit", 2_000_000n, 1_790_000n);
    },
    getStatus: async () => ({
      correlationId: "c",
      status: status as never,
      updatedAt: new Date(),
      raw: {},
      swapDetails: { amountIn: null, amountOut: status === "SUCCESS" ? 2_000_000n : null, depositedAmount: null, refundedAmount: null, refundReason: null, originChainTxHashes: [], destinationChainTxHashes: [], nearTxHashes: [], intentHashes: [] },
    }),
    submitDepositTx: async () => {
      throw new Error("unused");
    },
    generateIntent: async ({ standard, signerId }) => ({ intent: { standard, payload: JSON.stringify({ signer_id: signerId, intents: [{ intent: "transfer" }] }) }, correlationId: "c" }),
    submitIntent: async s => (calls.submitted.push(s), { intentHash: "IntentHash1", correlationId: "c" }),
  };
  return { client, calls, settle: () => (status = "SUCCESS") };
}

describe("the $2 test payment", () => {
  it("quotes exactly $2 from Base into the merchant's balance, refunding to their Base address", async () => {
    const one = fakeOneClick();
    const env = await setup({ oneclick: one.client });
    const { c, merchant } = await env.merchant();
    assert.equal((await c.call("POST", "/v1/onboarding/test-payment", { refund_address: "not-an-address" })).status, 400);
    const r = await c.call("POST", "/v1/onboarding/test-payment", { refund_address: BASE });
    assert.equal(r.status, 201);
    assert.equal(r.body.test_payment.deposit_address, "0xdeposit");
    const q = one.calls.quotes[0] as Record<string, unknown>;
    assert.equal(q.dry, false);
    assert.equal(q.swapType, "EXACT_OUTPUT");
    assert.equal(q.amount, 2_000_000n);
    assert.equal(q.originAsset, "nep141:base-usdc");
    assert.equal(q.recipient, merchant.intents_account_id);
    assert.equal(q.recipientType, "INTENTS");
    assert.equal(q.refundTo, BASE);
    await env.close();
  });

  it("refunds with one passkey signature over exactly 1Click's payload", async () => {
    const one = fakeOneClick();
    const env = await setup({ oneclick: one.client });
    const { c, auth } = await env.merchant();
    await c.call("POST", "/v1/onboarding/test-payment", { refund_address: BASE });
    assert.equal((await c.call("POST", "/v1/onboarding/test-payment/refund")).status, 409, "not arrived yet");
    one.settle();
    assert.equal((await c.call("GET", "/v1/onboarding/test-payment")).body.test_payment.status, "SUCCESS");

    const refund = await c.call("POST", "/v1/onboarding/test-payment/refund");
    assert.equal(refund.status, 200);
    const rq = one.calls.quotes[1] as Record<string, unknown>;
    assert.equal(rq.depositType, "INTENTS");
    assert.equal(rq.recipient, BASE);
    assert.equal(rq.recipientType, "DESTINATION_CHAIN");

    const signedFor = async (payload: string) =>
      webauthnSignedIntent({ payload, publicKeyP256: refund.body.signers[0].public_key_p256, assertion: auth.authenticate(await payloadChallenge(payload)).response });
    const tampered = await c.call("POST", "/v1/onboarding/test-payment/refund/submit", { signed: await signedFor(refund.body.payload.replace("transfer", "ft_withdraw")) });
    assert.equal(tampered.body.error, "payload_mismatch");

    const signed = await signedFor(refund.body.payload);
    const done = await c.call("POST", "/v1/onboarding/test-payment/refund/submit", { signed });
    assert.equal(done.body.intent_hash, "IntentHash1");
    assert.deepEqual(one.calls.submitted, [signed], "submitted exactly as signed");
    await env.close();
  });
});

describe("when 1Click is down", () => {
  it("gives a plain, skippable message instead of an error page", async () => {
    const { IntentsError } = await import("@morva/intents");
    const one = fakeOneClick();
    one.client.quote = async () => {
      throw new IntentsError("http", "POST /v0/quote returned 521: Web server is down", { status: 521 });
    };
    const env = await setup({ oneclick: one.client });
    const { c } = await env.merchant();
    const r = await c.call("POST", "/v1/onboarding/test-payment", { refund_address: BASE });
    assert.equal(r.status, 503);
    assert.match(r.body.message, /skip this step/);
    await env.close();
  });
});
