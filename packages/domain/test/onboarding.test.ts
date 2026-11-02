import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAdvance, canGoLive, nextStep, previousStep, resumeStep, validatePayoutAddress, type OnboardingState } from "../src/index.ts";

const fresh: OnboardingState = {
  handle: null,
  business_name: null,
  country: null,
  contact_email_verified: false,
  terms_accepted: false,
  has_passkey: false,
  onboarding_step: "business",
  live: false,
};
const done: OnboardingState = { ...fresh, handle: "northside", business_name: "Northside Events", country: "NG", contact_email_verified: true, terms_accepted: true, has_passkey: true };

describe("onboarding steps", () => {
  it("walks the steps in order, with no way back past the first", () => {
    assert.equal(nextStep("business"), "email");
    assert.equal(nextStep("test_payment"), "live");
    assert.equal(nextStep("live"), null);
    assert.equal(previousStep("email"), "business");
    assert.equal(previousStep("business"), null);
  });

  it("only advances past required steps once they are complete", () => {
    const r = canAdvance(fresh, "business");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /business name/);
    assert.deepEqual(canAdvance({ ...fresh, handle: "n", business_name: "N", country: "NG" }, "business"), { ok: true, to: "email" });
    assert.deepEqual(canAdvance({ ...fresh, handle: "n", business_name: "N", country: "NG", contact_email_verified: true }, "business"), { ok: true, to: "payout" }, "email from sign-up is passed over");
    assert.equal(canAdvance({ ...done, has_passkey: false }, "secure").ok, false);
    assert.deepEqual(canAdvance(done, "defaults"), { ok: true, to: "backup" }, "a passkey from sign-up passes over secure");
    assert.equal(canAdvance({ ...done, contact_email_verified: false }, "email").ok, false);
    assert.equal(canAdvance({ ...done, terms_accepted: false }, "terms").ok, false);
  });

  it("lets the backup device and the test payment be skipped, and nothing else", () => {
    assert.deepEqual(canAdvance(fresh, "backup", { skip: true }), { ok: true, to: "terms" });
    assert.equal(canAdvance(fresh, "secure", { skip: true }).ok, false, "the passkey can't be skipped");
    assert.deepEqual(canAdvance(fresh, "test_payment", { skip: true }), { ok: true, to: "live" });
    for (const step of ["business", "email", "terms"] as const) assert.equal(canAdvance(fresh, step, { skip: true }).ok, false, step);
  });

  it("resumes at the furthest step reached, or at an earlier step left incomplete", () => {
    assert.equal(resumeStep({ ...done, onboarding_step: "defaults" }), "defaults");
    assert.equal(resumeStep({ ...done, onboarding_step: "defaults", contact_email_verified: false }), "email");
    assert.equal(resumeStep({ ...fresh, onboarding_step: "not-a-step" }), "business");
    assert.equal(resumeStep({ ...done, onboarding_step: "terms", live: true }), "live");
  });

  it("goes live only with a business, a confirmed email and accepted terms", () => {
    assert.deepEqual(canGoLive(done), { ok: true });
    assert.equal(canGoLive({ ...done, terms_accepted: false }).ok, false);
    assert.equal(canGoLive({ ...done, handle: null }).ok, false);
    assert.equal(canGoLive({ ...done, has_passkey: false }).ok, false);
  });
});

describe("payout addresses", () => {
  it("accepts EVM addresses with a correct checksum, or all one case", () => {
    for (const a of ["0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE", "0x5aeda56215b167893e80b4fe645ba6d5bab767de", "0x5AEDA56215B167893E80B4FE645BA6D5BAB767DE"]) {
      assert.equal(validatePayoutAddress("base", a).ok, true, a);
    }
  });

  it("catches a mistyped EVM checksum and malformed addresses", () => {
    const bad = validatePayoutAddress("base", "0x5AEDA56215b167893e80B4fE645BA6d5Bab767De");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.message, /typo/);
    assert.equal(validatePayoutAddress("arb", "0x123").ok, false);
    assert.equal(validatePayoutAddress("base", "TQ7k9fXeabcdefghijkmnopqrstuvwxyz1").ok, false);
  });

  it("validates Solana and NEAR addresses", () => {
    assert.equal(validatePayoutAddress("sol", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin").ok, true);
    assert.equal(validatePayoutAddress("sol", "0x5aeda56215b167893e80b4fe645ba6d5bab767de").ok, false);
    assert.deepEqual(validatePayoutAddress("near", " Northside.near "), { ok: true, address: "northside.near" });
    assert.equal(validatePayoutAddress("near", "a".repeat(64)).ok, true);
    assert.equal(validatePayoutAddress("near", "bad..near").ok, false);
  });

  it("refuses chains Morva doesn't pay out to", () => {
    assert.equal(validatePayoutAddress("tron", "T").ok, false);
    assert.equal(validatePayoutAddress("btc", "bc1q").ok, false);
  });
});
