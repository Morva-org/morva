import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP_REQUIRED_ABOVE_USD_MICRO, checkMoneyAction, normalizeHandle, validateHandle } from "../src/index.ts";

describe("validateHandle", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    for (const h of ["abc", "northside-events", "studio42", "a1-b2-c3", "x".repeat(30)]) {
      assert.deepEqual(validateHandle(h), { ok: true }, h);
    }
  });

  it("names the problem for each kind of bad handle", () => {
    const cases: [string, string][] = [
      ["ab", "too_short"],
      ["x".repeat(31), "too_long"],
      ["North", "characters"],
      ["café", "characters"],
      ["has space", "characters"],
      ["under_score", "characters"],
      ["-lead", "edges"],
      ["trail-", "edges"],
      ["dou--ble", "double_hyphen"],
      ["admin", "reserved"],
      ["pay", "reserved"],
    ];
    for (const [h, problem] of cases) {
      const r = validateHandle(h);
      assert.equal(r.ok, false, h);
      if (!r.ok) {
        assert.equal(r.problem, problem, h);
        assert.ok(r.message.length > 0);
      }
    }
  });

  it("normalises before validating", () => {
    assert.equal(normalizeHandle("  Northside-Events "), "northside-events");
    assert.deepEqual(validateHandle(normalizeHandle(" Studio42 ")), { ok: true });
  });
});

describe("checkMoneyAction", () => {
  const over = BACKUP_REQUIRED_ABOVE_USD_MICRO + 1n;

  it("blocks withdrawals and payout changes over $100 until a backup passkey exists", () => {
    for (const type of ["withdraw", "payout_change"] as const) {
      const r = checkMoneyAction({ type, usdMicro: over }, 1);
      assert.equal(r.allowed, false);
      if (!r.allowed) {
        assert.equal(r.reason, "backup_required");
        assert.match(r.message, /backup device/);
      }
      assert.deepEqual(checkMoneyAction({ type, usdMicro: over }, 2), { allowed: true });
    }
  });

  it("allows $100 exactly and anything below with one passkey", () => {
    assert.deepEqual(checkMoneyAction({ type: "withdraw", usdMicro: BACKUP_REQUIRED_ABOVE_USD_MICRO }, 1), { allowed: true });
    assert.deepEqual(checkMoneyAction({ type: "payout_change", usdMicro: 0n }, 1), { allowed: true });
  });

  it("never blocks refunds on the backup rule", () => {
    assert.deepEqual(checkMoneyAction({ type: "refund", usdMicro: over }, 1), { allowed: true });
  });
});
