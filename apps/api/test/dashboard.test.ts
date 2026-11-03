import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { OneClickClient, Token } from "@morva/intents";
import { usdValue } from "../src/dashboard.ts";
import { setup } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setup>>;
afterEach(() => env?.close());

const tokens: Token[] = [
  { assetId: "nep141:usdc", blockchain: "near", symbol: "USDC", decimals: 6, contractAddress: "17208628", price: 10n ** 18n, priceUpdatedAt: new Date() },
  { assetId: "nep141:wrap.near", blockchain: "near", symbol: "wNEAR", decimals: 24, contractAddress: "wrap.near", price: 3n * 10n ** 18n, priceUpdatedAt: new Date() },
];
const oneclick = { getTokens: async () => tokens } as unknown as OneClickClient;

describe("the dashboard balance", () => {
  it("reads the merchant's own account and values each token in USD", async () => {
    const asked: string[] = [];
    env = await setup({
      oneclick,
      readBalances: async account => {
        asked.push(account);
        return new Map([
          ["nep141:usdc", 12_500_000n],
          ["nep141:wrap.near", 2n * 10n ** 24n],
          ["nep141:unknown", 5n],
        ]);
      },
    });
    const { c, merchant } = await env.merchant();
    const res = await c.call("GET", "/v1/me/balance");
    assert.equal(res.status, 200);
    assert.deepEqual(asked, [merchant.intents_account_id]);
    assert.equal(res.body.usd_total, 18.5);
    assert.deepEqual(
      res.body.lines.map((l: { symbol: string | null; usd: number | null }) => [l.symbol, l.usd]),
      [
        ["USDC", 12.5],
        ["wNEAR", 6],
        [null, null],
      ],
    );
  });

  it("is empty before the merchant has a passkey account", async () => {
    env = await setup({ readBalances: async () => assert.fail("no account to read") });
    const c = env.client();
    await c.call("POST", "/v1/auth/email/start", { email: "a@b.example" });
    await c.call("POST", "/v1/auth/email/verify", { email: "a@b.example", code: env.sent.at(-1)!.code });
    const res = await c.call("GET", "/v1/me/balance");
    assert.deepEqual(res.body, { account: null, lines: [], usd_total: 0 });
  });

  it("says plainly when the balance can't be read", async () => {
    env = await setup({
      readBalances: async () => {
        throw new Error("rpc down");
      },
    });
    const { c } = await env.merchant();
    const res = await c.call("GET", "/v1/me/balance");
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "balance_unavailable");
  });

  it("needs a session", async () => {
    env = await setup();
    assert.equal((await env.client().call("GET", "/v1/me/balance")).status, 401);
  });
});

describe("devices", () => {
  it("lists the merchant's passkeys without their keys", async () => {
    env = await setup();
    const { c } = await env.merchant();
    const res = await c.call("GET", "/v1/me/passkeys");
    assert.equal(res.body.passkeys.length, 1);
    assert.deepEqual(Object.keys(res.body.passkeys[0]).sort(), ["backed_up", "created_at", "device_label", "id", "last_used_at", "on_balance"]);
  });
});

describe("changing payouts with a passkey", () => {
  const WALLET = { mode: "auto_payout", chain: "base", address: "0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE" };
  const withBalance = (usdc: bigint) => ({ oneclick, readBalances: async () => new Map([["nep141:usdc", usdc]]) });

  it("applies exactly the change the passkey confirmed", async () => {
    env = await setup(withBalance(50_000_000n));
    const { c, auth } = await env.merchant();
    const opts = await c.call("POST", "/v1/me/payout/options", WALLET);
    assert.equal(opts.status, 200);
    const res = await c.call("POST", "/v1/me/payout", { ...WALLET, challengeId: opts.body.challengeId, response: auth.authenticate(opts.body.options.challenge) });
    assert.equal(res.status, 200);
    assert.equal(res.body.merchant.payout_mode, "auto_payout");
    assert.equal(res.body.merchant.payout_address.toLowerCase(), WALLET.address.toLowerCase());
    assert.equal(res.body.merchant.payout_chain, "base");
  });

  it("refuses a different change than the one confirmed", async () => {
    env = await setup(withBalance(50_000_000n));
    const { c, auth } = await env.merchant();
    const opts = await c.call("POST", "/v1/me/payout/options", WALLET);
    const other = { ...WALLET, address: "0x000000000000000000000000000000000000dEaD" };
    const res = await c.call("POST", "/v1/me/payout", { ...other, challengeId: opts.body.challengeId, response: auth.authenticate(opts.body.options.challenge) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "change_mismatch");
  });

  it("refuses another merchant's passkey", async () => {
    env = await setup(withBalance(50_000_000n));
    const { c } = await env.merchant();
    const stranger = await env.merchant();
    const opts = await c.call("POST", "/v1/me/payout/options", WALLET);
    const res = await c.call("POST", "/v1/me/payout", { ...WALLET, challengeId: opts.body.challengeId, response: stranger.auth.authenticate(opts.body.options.challenge) });
    assert.equal(res.status, 401);
  });

  it("needs a backup device when the balance is over $100", async () => {
    env = await setup(withBalance(150_000_000n));
    const { c } = await env.merchant();
    const res = await c.call("POST", "/v1/me/payout/options", WALLET);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "backup_required");
  });

  it("validates the address before asking for a passkey", async () => {
    env = await setup(withBalance(0n));
    const { c } = await env.merchant();
    const res = await c.call("POST", "/v1/me/payout/options", { ...WALLET, address: "nope" });
    assert.equal(res.status, 400);
  });
});

describe("usdValue", () => {
  it("rounds down to cents", () => {
    assert.equal(usdValue(1_999_999n, 6, 10n ** 18n), 1.99);
    assert.equal(usdValue(0n, 6, 10n ** 18n), 0);
  });
});
