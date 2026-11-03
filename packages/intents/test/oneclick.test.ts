import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOneClickClient, IntentsError, isTerminal, quoteRequestBody, type QuoteParams } from "../src/index.ts";
import { mockFetch, QUOTE_RESPONSE, STATUS_RESPONSE } from "./helpers.ts";

const BASE = "https://oneclick.test";
const deadline = new Date("2026-11-02T10:30:00.000Z");

const gatherLeg: QuoteParams = {
  dry: true,
  swapType: "EXACT_INPUT",
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: 2_000_000n,
  depositType: "ORIGIN_CHAIN",
  refundTo: "0xbuyer",
  recipient: "0xbuyer",
  recipientType: "INTENTS",
  deadline,
};

async function rejects(promise: Promise<unknown>, expected: Partial<IntentsError>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof IntentsError, `expected IntentsError, got ${String(error)}`);
    for (const [key, value] of Object.entries(expected)) assert.equal(error[key as keyof IntentsError], value, key);
    return true;
  });
}

describe("createOneClickClient", () => {
  it("sends the partner key as X-API-Key and omits it when absent", async () => {
    const withKey = mockFetch({ body: [] });
    await createOneClickClient({ apiKey: "secret", baseUrl: BASE, fetch: withKey.fetcher }).getTokens();
    assert.equal(withKey.calls[0]!.headers["X-API-Key"], "secret");

    const without = mockFetch({ body: [] });
    await createOneClickClient({ baseUrl: BASE, fetch: without.fetcher }).getTokens();
    assert.equal("X-API-Key" in without.calls[0]!.headers, false);
  });

  it("refuses to hold the partner key in a browser", () => {
    const g = globalThis as { window?: unknown };
    g.window = {};
    try {
      assert.throws(() => createOneClickClient({ apiKey: "secret" }), /server-only/);
      assert.doesNotThrow(() => createOneClickClient({}));
    } finally {
      delete g.window;
    }
  });
});

describe("getTokens", () => {
  it("parses prices to bigint, lowercases contracts and drops malformed entries", async () => {
    const { fetcher, calls } = mockFetch({
      body: [
        { assetId: "nep141:base.omft.near", blockchain: "base", symbol: "ETH", decimals: 18, price: 2328.18, priceUpdatedAt: "2026-10-27T00:00:00Z" },
        { assetId: "nep141:eth-0x95ad.omft.near", blockchain: "eth", symbol: "SHIB", decimals: 18, price: 4.86e-6, contractAddress: "0x95AD", priceUpdatedAt: "2026-10-27T00:00:00Z" },
        { assetId: "broken", blockchain: "eth", symbol: "X", decimals: "18", price: 1, priceUpdatedAt: "2026-10-27T00:00:00Z" },
        { blockchain: "eth", symbol: "NOID", decimals: 6, price: 1, priceUpdatedAt: "2026-10-27T00:00:00Z" },
      ],
    });
    const tokens = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).getTokens();
    assert.equal(calls[0]!.url, `${BASE}/v0/tokens`);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0]!.price, 2_328_180_000_000_000_000_000n);
    assert.equal(tokens[0]!.contractAddress, null);
    assert.equal(tokens[1]!.price, 4_860_000_000_000n);
    assert.equal(tokens[1]!.contractAddress, "0x95ad");
  });

  it("rejects a body that is not a list", async () => {
    const { fetcher } = mockFetch({ body: { tokens: [] } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: fetcher }).getTokens(), { kind: "invalid_response", path: "/v0/tokens" });
  });
});

describe("quote", () => {
  it("builds the gather-leg request: EXACT_INPUT into the buyer's own Intents account", () => {
    assert.deepEqual(quoteRequestBody(gatherLeg), {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: gatherLeg.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: gatherLeg.destinationAsset,
      amount: "2000000",
      refundTo: "0xbuyer",
      refundType: "ORIGIN_CHAIN",
      recipient: "0xbuyer",
      recipientType: "INTENTS",
      deadline: "2026-11-02T10:30:00.000Z",
      quoteWaitingTimeMs: 3000,
    });
  });

  it("builds the pay request: EXACT_OUTPUT from the Intents balance, with app fees", () => {
    const body = quoteRequestBody({
      ...gatherLeg,
      dry: false,
      swapType: "EXACT_OUTPUT",
      originAsset: gatherLeg.destinationAsset,
      amount: 25_000_000n,
      depositType: "INTENTS",
      recipient: "merchant.near",
      appFees: [{ recipient: "morva.near", feeBps: 50 }],
      confidentiality: "basic",
    });
    assert.equal(body.refundType, "INTENTS");
    assert.equal(body.amount, "25000000");
    assert.deepEqual(body.appFees, [{ recipient: "morva.near", fee: 50 }]);
    assert.equal(body.confidentiality, "basic");
  });

  it("lowercases 0x addresses used as Intents accounts and leaves origin-chain addresses alone", () => {
    const checksummed = "0x5aEda56215b167893e80B4fE645BA6d5Bab767DE";
    const gather = quoteRequestBody({ ...gatherLeg, refundTo: checksummed, recipient: checksummed });
    assert.equal(gather.refundTo, checksummed);
    assert.equal(gather.recipient, checksummed.toLowerCase());
    const pay = quoteRequestBody({ ...gatherLeg, depositType: "INTENTS", refundTo: checksummed, recipient: "Merchant.near" });
    assert.equal(pay.refundTo, checksummed.toLowerCase());
    assert.equal(pay.recipient, "Merchant.near");
  });

  it("rejects bad input before any request", () => {
    for (const bad of [
      { amount: 0n },
      { amount: -1n },
      { amount: 1 as unknown as bigint },
      { refundTo: "" },
      { recipient: "" },
      { deadline: new Date("nope") },
      { slippageBps: 1.5 },
      { appFees: [{ recipient: "", feeBps: 10 }] },
    ]) {
      assert.throws(() => quoteRequestBody({ ...gatherLeg, ...bad }), (e: unknown) => e instanceof IntentsError && e.kind === "invalid_request");
    }
  });

  it("parses amounts and USD values to bigint and keeps the signature and raw body", async () => {
    const { fetcher, calls } = mockFetch({ body: QUOTE_RESPONSE });
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).quote(gatherLeg);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.url, `${BASE}/v0/quote`);
    assert.equal(result.signature, "ed25519:quote-sig");
    assert.equal(result.quote.amountIn, 2_000_000n);
    assert.equal(result.quote.minAmountOut, 1_979_802n);
    assert.equal(result.quote.amountOutUsd, 1_998_734n);
    assert.equal(result.quote.timeEstimateSeconds, 20);
    assert.equal(result.quote.refundFee, null);
    assert.deepEqual(result.raw, QUOTE_RESPONSE);
  });

  it("insists a real quote has a deposit address", async () => {
    const { fetcher } = mockFetch({ body: { ...QUOTE_RESPONSE, quote: { ...QUOTE_RESPONSE.quote, depositAddress: undefined } } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: fetcher }).quote({ ...gatherLeg, dry: false }), { kind: "invalid_response" });
  });

  it("surfaces the API's message on a 400", async () => {
    const { fetcher } = mockFetch({ status: 400, body: { message: "Amount is too low for bridge, try at least 1210000" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: fetcher }).quote(gatherLeg), {
      kind: "http",
      status: 400,
      path: "/v0/quote",
      message: "POST /v0/quote returned 400: Amount is too low for bridge, try at least 1210000",
      minAmount: 1_210_000n,
    });
  });

  it("leaves minAmount unset on other 400s", async () => {
    const { fetcher } = mockFetch({ status: 400, body: { message: "Failed to get quote" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: fetcher }).quote(gatherLeg), { kind: "http", minAmount: undefined });
  });

  it("reports 401, 5xx with a non-JSON body, and a non-integer amount", async () => {
    let m = mockFetch({ status: 401, body: { message: "Unauthorized" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "http", status: 401 });
    m = mockFetch({ status: 502, body: "<html>bad gateway</html>" });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "http", status: 502, body: "<html>bad gateway</html>" });
    m = mockFetch({ body: { ...QUOTE_RESPONSE, quote: { ...QUOTE_RESPONSE.quote, amountIn: "2.5" } } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "invalid_response" });
  });

  it("separates network failures, timeouts and non-JSON success bodies", async () => {
    let m = mockFetch(new TypeError("fetch failed"));
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "network" });
    m = mockFetch(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "timeout" });
    m = mockFetch({ body: "not json" });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).quote(gatherLeg), { kind: "invalid_response" });
  });
});

describe("getStatus", () => {
  it("queries by deposit address and memo and parses details", async () => {
    const { fetcher, calls } = mockFetch({ body: STATUS_RESPONSE });
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).getStatus("0xdeposit", "memo-1");
    assert.equal(calls[0]!.url, `${BASE}/v0/status?depositAddress=0xdeposit&depositMemo=memo-1`);
    assert.equal(result.status, "SUCCESS");
    assert.ok(isTerminal(result.status));
    assert.equal(result.swapDetails.amountOut, 1_999_800n);
    assert.deepEqual(result.swapDetails.originChainTxHashes, ["0xorigin"]);
    assert.equal(result.swapDetails.refundedAmount, null);
  });

  it("accepts a pending status with no swap details yet", async () => {
    const { fetcher } = mockFetch({ body: { ...STATUS_RESPONSE, status: "PENDING_DEPOSIT", swapDetails: undefined } });
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).getStatus("0xdeposit");
    assert.equal(result.status, "PENDING_DEPOSIT");
    assert.equal(isTerminal(result.status), false);
    assert.deepEqual(result.swapDetails.intentHashes, []);
  });

  it("rejects unknown statuses, 404s and a missing address", async () => {
    let m = mockFetch({ body: { ...STATUS_RESPONSE, status: "MAYBE" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).getStatus("0xdeposit"), { kind: "invalid_response" });
    m = mockFetch({ status: 404, body: { message: "Deposit address not found" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).getStatus("0xdeposit"), { kind: "http", status: 404 });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: m.fetcher }).getStatus(""), { kind: "invalid_request" });
  });
});

describe("submitDepositTx", () => {
  it("forwards the tx hash and returns the status", async () => {
    const { fetcher, calls } = mockFetch({ body: { ...STATUS_RESPONSE, status: "KNOWN_DEPOSIT_TX" } });
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).submitDepositTx({ txHash: "0xtx", depositAddress: "0xdeposit" });
    assert.deepEqual(calls[0]!.body, { txHash: "0xtx", depositAddress: "0xdeposit" });
    assert.equal(result.status, "KNOWN_DEPOSIT_TX");
  });

  it("validates input and reports API errors", async () => {
    const m = mockFetch({ status: 400, body: { message: ["txHash must be a string"] } });
    const client = createOneClickClient({ baseUrl: BASE, fetch: m.fetcher });
    await rejects(client.submitDepositTx({ txHash: "", depositAddress: "0xdeposit" }), { kind: "invalid_request" });
    await rejects(client.submitDepositTx({ txHash: "0xtx", depositAddress: "0xdeposit" }), {
      kind: "http",
      message: "POST /v0/deposit/submit returned 400: txHash must be a string",
    });
  });
});

describe("generateIntent and submitIntent", () => {
  it("generates the erc191 payload to sign", async () => {
    const { fetcher, calls } = mockFetch({ body: { intent: { standard: "erc191", payload: "{\"signer_id\":\"0xbuyer\"}" }, correlationId: "c-2" } });
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).generateIntent({ standard: "erc191", signerId: "0xbuyer", depositAddress: "dep" });
    assert.deepEqual(calls[0]!.body, { type: "swap_transfer", standard: "erc191", signerId: "0xbuyer", depositAddress: "dep" });
    assert.deepEqual(result, { intent: { standard: "erc191", payload: "{\"signer_id\":\"0xbuyer\"}" }, correlationId: "c-2" });
  });

  it("rejects an intent in a different standard than requested", async () => {
    const { fetcher } = mockFetch({ body: { intent: { standard: "nep413", payload: {} }, correlationId: "c-2" } });
    await rejects(createOneClickClient({ baseUrl: BASE, fetch: fetcher }).generateIntent({ standard: "erc191", signerId: "0xbuyer", depositAddress: "dep" }), {
      kind: "invalid_response",
    });
  });

  it("submits the signed payload and returns the intent hash", async () => {
    const { fetcher, calls } = mockFetch({ body: { intentHash: "hash-1", correlationId: "c-2" } });
    const signed = { standard: "erc191" as const, payload: "p", signature: "secp256k1:abc" };
    const result = await createOneClickClient({ baseUrl: BASE, fetch: fetcher }).submitIntent(signed);
    assert.deepEqual(calls[0]!.body, { type: "swap_transfer", signedData: signed });
    assert.deepEqual(result, { intentHash: "hash-1", correlationId: "c-2" });
  });

  it("reports a rejected signature and a missing signature", async () => {
    const { fetcher } = mockFetch({ status: 400, body: { message: "invalid signature" } });
    const client = createOneClickClient({ baseUrl: BASE, fetch: fetcher });
    await rejects(client.submitIntent({ standard: "erc191", payload: "p", signature: "" }), { kind: "invalid_request" });
    await rejects(client.submitIntent({ standard: "erc191", payload: "p", signature: "secp256k1:bad" }), { kind: "http", status: 400 });
  });
});
