import test from "node:test";
import assert from "node:assert/strict";
import { base58, client, erc191Signature, findAsset, parseArgs, pollStatus, quoteBody, run } from "./payment-spike.mjs";

const token = (blockchain, symbol, decimals = 6) => ({ assetId: `nep141:${blockchain}-${symbol}`, blockchain, symbol, decimals });
const catalog = [token("tron", "USDT"), token("near", "USDC"), token("arb", "USDC"), token("base", "USDC")];
const env = { SPIKE_TRON_REFUND_ADDRESS: "Tbuyer", SPIKE_MERCHANT_INTENTS_ACCOUNT: "merchant.near" };
const silent = () => {};

function fakeApi(responses) {
  const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: options.body && JSON.parse(options.body), headers: options.headers });
    const body = path === "/v0/tokens" ? catalog : responses[path];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => JSON.stringify(body) };
  };
  return { calls, fetcher };
}

test("requires a test number and rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--test=4", "--live", "--deposit-address=abc"]),
    { test: 4, live: true, check: false, depositAddress: "abc" });
  assert.throws(() => parseArgs([]), /--test/);
  assert.throws(() => parseArgs(["--test=9"]), /--test/);
  assert.throws(() => parseArgs(["test=1"]), /Unrecognized/);
});

test("resolves asset IDs from the catalog and fails on ambiguity", () => {
  assert.equal(findAsset(catalog, "tron", "USDT").assetId, "nep141:tron-USDT");
  assert.throws(() => findAsset(catalog, "sol", "USDC"), /found 0/);
  assert.throws(() => findAsset([...catalog, token("tron", "USDT")], "tron", "USDT"), /found 2/);
  assert.throws(() => findAsset({ tokens: [] }, "tron", "USDT"), /array/);
});

test("quotes use base units and always carry a refund address", () => {
  const body = quoteBody({ dry: true, amount: "1000000", refundTo: "Tbuyer" });
  assert.equal(body.swapType, "EXACT_OUTPUT");
  assert.ok(Date.parse(body.deadline) > Date.now());
  for (const amount of ["1.5", "0", "-1", ""]) assert.throws(() => quoteBody({ amount, refundTo: "x" }), /base units/);
  assert.throws(() => quoteBody({ amount: "1" }), /refundTo/);
});

test("test 1 asks for exact USDC into the merchant's Intents balance, dry by default", async () => {
  const { calls, fetcher } = fakeApi({ "/v0/quote": { quote: { amountIn: "1010000" } } });
  const log = console.log; console.log = silent;
  try { await run(["--test=1"], { ...env, ONECLICK_API_KEY: "k" }, fetcher); } finally { console.log = log; }
  const quote = calls.find(c => c.path === "/v0/quote");
  assert.equal(quote.headers["X-API-Key"], "k");
  assert.deepEqual({ ...quote.body, deadline: undefined }, {
    dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: "nep141:tron-USDT",
    destinationAsset: "nep141:near-USDC", amount: "1000000", depositType: "ORIGIN_CHAIN", refundTo: "Tbuyer",
    refundType: "ORIGIN_CHAIN", recipient: "merchant.near", recipientType: "INTENTS", deadline: undefined,
    quoteWaitingTimeMs: 3000,
  });
  assert.ok(!calls.some(c => c.path === "/v0/status"), "a dry quote must not start polling");
});

test("test 4 quotes a refund from Intents USDC to exact USDT on the buyer's Tron address", async () => {
  const { calls, fetcher } = fakeApi({ "/v0/quote": { quote: {} } });
  const log = console.log; console.log = silent;
  try { await run(["--test=4", "--amount=2500000"], env, fetcher); } finally { console.log = log; }
  const { body } = calls.find(c => c.path === "/v0/quote");
  assert.equal(body.dry, true);
  assert.equal(body.originAsset, "nep141:near-USDC");
  assert.equal(body.destinationAsset, "nep141:tron-USDT");
  assert.equal(body.amount, "2500000");
  assert.equal(body.depositType, "INTENTS");
  assert.equal(body.refundTo, "merchant.near");
  assert.equal(body.recipient, "Tbuyer");
  assert.equal(body.recipientType, "DESTINATION_CHAIN");
});

test("missing configuration fails before any quote is requested", async () => {
  const { calls, fetcher } = fakeApi({});
  await assert.rejects(run(["--test=1"], {}, fetcher), /SPIKE_TRON_REFUND_ADDRESS/);
  assert.ok(!calls.some(c => c.path === "/v0/quote"));
});

test("HTTP failures surface the provider message", async () => {
  const api = client({ fetcher: async () => ({ ok: false, status: 400, text: async () => '{"message":"Amount is too low"}' }) });
  await assert.rejects(api.quote({}), /400.*Amount is too low/);
});

test("polling stops on terminal status or timeout", async () => {
  const states = ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS", "SUCCESS"];
  const api = { status: async () => ({ status: states.shift() }) };
  assert.equal((await pollStatus(api, "addr", { sleep: async () => {}, log: silent })).status, "SUCCESS");
  const stuck = { status: async () => ({ status: "PENDING_DEPOSIT" }) };
  assert.equal((await pollStatus(stuck, "addr", { timeoutMs: 0, sleep: async () => {}, log: silent })).timedOut, true);
});

test("base58 matches known vectors, including leading zeros", () => {
  assert.equal(base58(Buffer.from("Hello World!")), "2NEpo7TZRRrLZSi2U");
  assert.equal(base58(Buffer.from([0, 0, 1])), "112");
  assert.equal(base58(Buffer.alloc(0)), "");
});

test("erc191 signatures normalize v to 0/1 for the Verifier", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { recoverMessageAddress } = await import("viem");
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const hex = await account.signMessage({ message: "{\"signer_id\":\"x\"}" });
  const encoded = erc191Signature(hex);
  assert.match(encoded, /^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
  const v = Buffer.from(hex.slice(2), "hex")[64];
  const flipped = `${hex.slice(0, -2)}${(v - 27).toString(16).padStart(2, "0")}`;
  assert.equal(erc191Signature(flipped), encoded, "0/1 and 27/28 inputs encode the same");
  assert.equal(await recoverMessageAddress({ message: "{\"signer_id\":\"x\"}", signature: hex }), account.address);
  assert.throws(() => erc191Signature("0x1234"), /65-byte/);
});
