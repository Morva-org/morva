import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  base58,
  createTokenCatalog,
  evmIntentsAccount,
  formatUnits,
  getIntentsBalances,
  IntentsError,
  parseDecimal,
  toVerifierErc191Signature,
  usdValue,
  priceFromNumber,
  type Token,
} from "../src/index.ts";
import { mockFetch } from "./helpers.ts";

const token = (over: Partial<Token>): Token => ({
  assetId: "a",
  blockchain: "base",
  symbol: "USDC",
  decimals: 6,
  contractAddress: null,
  price: 10n ** 18n,
  priceUpdatedAt: new Date(0),
  ...over,
});

describe("money", () => {
  it("parses decimals, exponents and truncates extra precision", () => {
    assert.equal(parseDecimal("1.9989", 6), 1_998_900n);
    assert.equal(parseDecimal("2", 6), 2_000_000n);
    assert.equal(parseDecimal("0.0000019", 6), 1n);
    assert.equal(parseDecimal("4.86e-06", 18), 4_860_000_000_000n);
    assert.equal(parseDecimal("1.5E+3", 0), 1500n);
    assert.throws(() => parseDecimal("-1", 6), RangeError);
    assert.throws(() => parseDecimal("abc", 6), RangeError);
  });

  it("values holdings in micro-USD without floats", () => {
    // 0.01 ETH at $2328.18 = $23.2818
    assert.equal(usdValue(10n ** 16n, 18, priceFromNumber(2328.18)), 23_281_800n);
    // 2.5 USDC at $0.999467
    assert.equal(usdValue(2_500_000n, 6, priceFromNumber(0.999467)), 2_498_667n);
    assert.equal(formatUnits(2_498_667n, 6), "2.498667");
    assert.equal(formatUnits(25_000_000n, 6), "25");
    assert.equal(formatUnits(5n, 6), "0.000005");
  });
});

describe("createTokenCatalog", () => {
  const tokens = [
    token({ assetId: "base-usdc", contractAddress: "0x8335" }),
    token({ assetId: "base-eth", symbol: "ETH", decimals: 18 }),
    token({ assetId: "op-usdt", blockchain: "op", symbol: "USDT" }),
    token({ assetId: "op-usdt0", blockchain: "op", symbol: "USDT" }),
  ];

  it("caches within the TTL, refetches after it, and shares one in-flight request", async () => {
    let fetches = 0;
    let clock = 0;
    const catalog = createTokenCatalog({ getTokens: async () => (fetches++, tokens) }, { ttlMs: 1000, now: () => clock });
    await Promise.all([catalog.all(), catalog.all()]);
    assert.equal(fetches, 1);
    clock = 999;
    await catalog.all();
    assert.equal(fetches, 1);
    clock = 1000;
    await catalog.all();
    assert.equal(fetches, 2);
  });

  it("serves a stale catalog when a refresh fails, and fails when there is none", async () => {
    let fail = false;
    let clock = 0;
    const catalog = createTokenCatalog(
      { getTokens: async () => { if (fail) throw new IntentsError("network", "down"); return tokens; } },
      { ttlMs: 10, now: () => clock },
    );
    await catalog.all();
    fail = true;
    clock = 100;
    assert.equal((await catalog.all()).length, 4);

    const empty = createTokenCatalog({ getTokens: async () => { throw new IntentsError("network", "down"); } });
    await assert.rejects(empty.all(), /down/);
  });

  it("resolves by asset ID, symbol and contract (null for native)", async () => {
    const catalog = createTokenCatalog({ getTokens: async () => tokens });
    assert.equal((await catalog.byAssetId("base-eth"))?.symbol, "ETH");
    assert.equal((await catalog.find("base", "USDC")).assetId, "base-usdc");
    assert.equal((await catalog.byContract("base", "0x8335"))?.assetId, "base-usdc");
    assert.equal((await catalog.byContract("BASE", "0x8335")), undefined);
    assert.equal((await catalog.byContract("base", null))?.assetId, "base-eth");
    await assert.rejects(catalog.find("op", "USDT"), /found 2/);
    await assert.rejects(catalog.find("base", "DAI"), /found 0/);
  });
});

describe("getIntentsBalances", () => {
  const rpcResult = (value: unknown) => ({ body: { jsonrpc: "2.0", id: "morva", result: { result: [...Buffer.from(JSON.stringify(value))] } } });
  const args = (call: { body: unknown }) => {
    const params = (call.body as { params: { method_name: string; args_base64: string; account_id: string } }).params;
    return { method: params.method_name, contract: params.account_id, args: JSON.parse(Buffer.from(params.args_base64, "base64").toString()) };
  };

  it("reads the requested token IDs with mt_batch_balance_of, zeros included", async () => {
    const { fetcher, calls } = mockFetch(rpcResult(["2500000", "0"]));
    const balances = await getIntentsBalances("0xbuyer", { tokenIds: ["usdc", "usdt"], fetch: fetcher, rpcUrl: "https://rpc.test" });
    assert.equal(calls[0]!.url, "https://rpc.test");
    assert.deepEqual(args(calls[0]!), { method: "mt_batch_balance_of", contract: "intents.near", args: { account_id: "0xbuyer", token_ids: ["usdc", "usdt"] } });
    assert.deepEqual([...balances], [["usdc", 2_500_000n], ["usdt", 0n]]);
  });

  it("lists every held token across pages when no IDs are given, dropping zeros", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ token_id: `t${i}` }));
    const amounts: string[] = page1.map((_, i): string => (i === 0 ? "7" : "0")).concat(["9"]);
    const { fetcher, calls } = mockFetch(rpcResult(page1), rpcResult([{ token_id: "t100" }]), rpcResult(amounts));
    const balances = await getIntentsBalances("0xbuyer", { fetch: fetcher });
    assert.equal(args(calls[0]!).args.from_index, "0");
    assert.equal(args(calls[1]!).args.from_index, "100");
    assert.equal(args(calls[2]!).args.token_ids.length, 101);
    assert.deepEqual([...balances], [["t0", 7n], ["t100", 9n]]);
  });

  it("returns an empty map for an account with nothing, without a balance call", async () => {
    const { fetcher, calls } = mockFetch(rpcResult([]));
    assert.equal((await getIntentsBalances("0xnew", { fetch: fetcher })).size, 0);
    assert.equal(calls.length, 1);
  });

  it("reports RPC errors, contract errors, bad shapes and network failures", async () => {
    const cases: [ReturnType<typeof mockFetch>, string][] = [
      [mockFetch({ body: { error: { name: "HANDLER_ERROR" } } }), "rpc"],
      [mockFetch({ body: { result: { error: "wasm execution failed" } } }), "rpc"],
      [mockFetch({ status: 503, body: "busy" }), "rpc"],
      [mockFetch(rpcResult(["1"])), "rpc"], // two IDs asked, one balance returned
      [mockFetch(rpcResult(["1.5", "0"])), "rpc"],
      [mockFetch(new TypeError("fetch failed")), "network"],
    ];
    for (const [m, kind] of cases) {
      await assert.rejects(getIntentsBalances("0xbuyer", { tokenIds: ["a", "b"], fetch: m.fetcher }), (e: unknown) => e instanceof IntentsError && e.kind === kind);
    }
    await assert.rejects(getIntentsBalances(""), (e: unknown) => e instanceof IntentsError && e.kind === "invalid_request");
  });

  it("maps an EVM address to its lowercase implicit account", () => {
    assert.equal(evmIntentsAccount("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"), "0xabcdef0123456789abcdef0123456789abcdef01");
    assert.throws(() => evmIntentsAccount("0x123"), IntentsError);
  });
});

describe("erc191", () => {
  it("base58 matches known vectors", () => {
    assert.equal(base58(new Uint8Array([])), "");
    assert.equal(base58(new Uint8Array([0, 0, 1])), "112");
    assert.equal(base58(new TextEncoder().encode("hello world")), "StV1DL6CwTryKyV");
  });

  it("normalizes v to 0/1 and stays recoverable", async () => {
    // Anvil/Hardhat default test account 1: a publicly known key that never holds funds.
    const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const message = "{\"intents\":[]}";
    const hex = await account.signMessage({ message });
    const encoded = toVerifierErc191Signature(hex);
    assert.match(encoded, /^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
    // Re-derive the hex with v back at 27/28 and check it still recovers the signer.
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n;
    for (const c of encoded.slice("secp256k1:".length)) n = n * 58n + BigInt(alphabet.indexOf(c));
    const bytes = n.toString(16).padStart(130, "0");
    const v = parseInt(bytes.slice(128), 16);
    assert.ok(v === 0 || v === 1);
    const restored = `0x${bytes.slice(0, 128)}${(v + 27).toString(16)}` as `0x${string}`;
    assert.equal(await recoverMessageAddress({ message, signature: restored }), account.address);
  });

  it("rejects malformed signatures", () => {
    assert.throws(() => toVerifierErc191Signature("0x1234"), RangeError);
    assert.throws(() => toVerifierErc191Signature(`0x${"00".repeat(64)}05`), RangeError);
  });
});
