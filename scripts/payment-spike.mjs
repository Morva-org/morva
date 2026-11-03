// Gate 1 spike: throwaway research code for NEAR Intents 1Click. Not product code.
// Usage: npm run spike:payments -- --test=1 [--live] [--amount=1000000] [--deposit-address=...]
// Without --live every quote is dry: no deposit address is created and nothing can move funds.
import { pathToFileURL } from "node:url";
import { assertTestSpend, testSpendCap } from "./test-spend.mjs";

export const ONECLICK = "https://1click.chaindefuser.com";
export const VERIFIER = "intents.near";
export const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export function parseArgs(argv) {
  const args = { test: null, live: false, check: false };
  for (const arg of argv) {
    const [, key, value] = arg.match(/^--([a-z-]+)(?:=(.*))?$/) ?? [];
    if (!key) throw new Error(`Unrecognized argument: ${arg}`);
    const name = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[name] = value ?? true;
  }
  args.test = Number(args.test);
  if (![1, 2, 3, 4, 5].includes(args.test)) throw new Error("Pass --test=1..5");
  return args;
}

export function findAsset(tokens, blockchain, symbol) {
  if (!Array.isArray(tokens)) throw new Error("Expected a token catalog array");
  const matches = tokens.filter(t => t?.blockchain === blockchain && t?.symbol === symbol);
  if (matches.length !== 1) throw new Error(`Expected one ${symbol} on ${blockchain}, found ${matches.length}`);
  const { assetId, decimals } = matches[0];
  if (typeof assetId !== "string" || !Number.isInteger(decimals)) throw new Error("Unexpected token catalog schema");
  return { assetId, decimals, blockchain, symbol };
}

// The deadline bounds when refunds begin; it is not the buyer-facing countdown.
export function quoteBody({ dry, swapType = "EXACT_OUTPUT", originAsset, destinationAsset, amount,
  depositType, refundTo, refundType, recipient, recipientType, minutes = 30, extra = {} }) {
  if (!/^[1-9]\d*$/.test(String(amount))) throw new Error("amount must be a positive integer in base units");
  if (!refundTo) throw new Error("refundTo is required: some swap types retry instead of refunding");
  return {
    dry, swapType, slippageTolerance: 100, originAsset, destinationAsset, amount: String(amount),
    depositType, refundTo, refundType, recipient, recipientType,
    deadline: new Date(Date.now() + minutes * 60_000).toISOString(), quoteWaitingTimeMs: 3000, ...extra,
  };
}

export function client({ apiKey, fetcher = fetch, base = ONECLICK }) {
  const call = async (method, path, body) => {
    const headers = { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) };
    const response = await fetcher(`${base}${path}`, {
      method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  };
  return {
    tokens: () => call("GET", "/v0/tokens"),
    quote: body => call("POST", "/v0/quote", body),
    status: (depositAddress, depositMemo) => call("GET", `/v0/status?${new URLSearchParams(
      { depositAddress, ...(depositMemo ? { depositMemo } : {}) })}`),
    generateIntent: body => call("POST", "/v0/generate-intent", { type: "swap_transfer", ...body }),
    submitIntent: signedData => call("POST", "/v0/submit-intent", { type: "swap_transfer", signedData }),
  };
}

export async function pollStatus(api, depositAddress, { intervalMs = 10_000, timeoutMs = 30 * 60_000,
  sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  const started = Date.now();
  for (;;) {
    const result = await api.status(depositAddress);
    log(`${new Date().toISOString()} ${result.status}`);
    if (TERMINAL.has(result.status)) return result;
    if (Date.now() - started >= timeoutMs) return { ...result, timedOut: true };
    await sleep(intervalMs);
  }
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}

// Wallets return v as 27/28; the Verifier expects 0/1 and the "secp256k1:" + base58(r||s||v) encoding.
export function erc191Signature(hex) {
  const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (bytes.length !== 65) throw new Error("Expected a 65-byte secp256k1 signature");
  if (bytes[64] >= 27) bytes[64] -= 27;
  if (bytes[64] > 1) throw new Error("Unexpected recovery byte");
  return `secp256k1:${base58(bytes)}`;
}

export async function verifierBalances(account, tokenIds, { fetcher = fetch,
  rpc = process.env.NEAR_RPC_URL || "https://rpc.mainnet.fastnear.com" } = {}) {
  const args = Buffer.from(JSON.stringify({ account_id: account, token_ids: tokenIds })).toString("base64");
  const response = await fetcher(rpc, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "spike", method: "query", params: {
      request_type: "call_function", finality: "final", account_id: VERIFIER,
      method_name: "mt_batch_balance_of", args_base64: args } }),
  });
  const json = await response.json();
  if (json.error || json.result?.error) throw new Error(`NEAR RPC error: ${JSON.stringify(json.error ?? json.result.error)}`);
  const balances = JSON.parse(Buffer.from(json.result.result).toString());
  return Object.fromEntries(tokenIds.map((id, i) => [id, balances[i]]));
}

const need = (env, name) => {
  if (!env[name]) throw new Error(`Set ${name} in .env (see .env.example)`);
  return env[name];
};
const summarize = ({ correlationId, signature, quote }) => ({ correlationId, quoteSignature: signature, quote });

// 1. Deposit path: USDT on Tron in, exact USDC out into the merchant's NEAR Intents balance.
async function test1(api, tokens, args, env) {
  const usdt = findAsset(tokens, "tron", "USDT"), usdc = findAsset(tokens, "near", "USDC");
  if (args.depositAddress) return pollStatus(api, args.depositAddress);
  const quote = await api.quote(quoteBody({
    dry: !args.live, originAsset: usdt.assetId, destinationAsset: usdc.assetId, amount: args.amount ?? "1000000",
    depositType: "ORIGIN_CHAIN", refundTo: need(env, "SPIKE_TRON_REFUND_ADDRESS"), refundType: "ORIGIN_CHAIN",
    recipient: need(env, "SPIKE_MERCHANT_INTENTS_ACCOUNT"), recipientType: "INTENTS",
  }));
  console.log(JSON.stringify(summarize(quote), null, 2));
  if (!args.live) return quote;
  console.log(`Send ${quote.quote.amountInFormatted} USDT on Tron to ${quote.quote.depositAddress}, then watch status.`);
  return pollStatus(api, quote.quote.depositAddress);
}

async function evmAccount(env) {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(need(env, "SPIKE_EVM_PRIVATE_KEY"));
}

async function signAndSubmit(api, account, depositAddress) {
  const signerId = account.address.toLowerCase();
  const { intent } = await api.generateIntent({ standard: "erc191", signerId, depositAddress });
  console.log("Intent to sign:", intent.payload);
  const signature = erc191Signature(await account.signMessage({ message: intent.payload }));
  console.log(JSON.stringify(await api.submitIntent({ ...intent, signature }), null, 2));
  return pollStatus(api, depositAddress);
}

// 2. Signed-intent path: pay from the buyer's NEAR Intents balance with one erc191 signature.
async function test2(api, tokens, args, env) {
  const account = await evmAccount(env);
  const signerId = account.address.toLowerCase();
  const from = findAsset(tokens, args.from ?? "base", "USDC"), usdc = findAsset(tokens, "near", "USDC");
  const quote = await api.quote(quoteBody({
    dry: !args.live, originAsset: from.assetId, destinationAsset: usdc.assetId, amount: args.amount ?? "1000000",
    depositType: "INTENTS", refundTo: signerId, refundType: "INTENTS",
    recipient: need(env, "SPIKE_MERCHANT_INTENTS_ACCOUNT"), recipientType: "INTENTS",
  }));
  console.log(JSON.stringify(summarize(quote), null, 2));
  if (!args.live) return quote;
  return signAndSubmit(api, account, quote.quote.depositAddress);
}

// 3. Address mapping: one 0x address funds its own Verifier account from Arbitrum and from Base.
async function test3(api, tokens, args, env) {
  const address = (await evmAccount(env)).address.toLowerCase();
  const legs = ["arb", "base"].map(chain => findAsset(tokens, chain, "USDC"));
  if (args.check) {
    const balances = await verifierBalances(address, legs.map(l => l.assetId));
    console.log(JSON.stringify({ account: address, balances }, null, 2));
    return balances;
  }
  const quotes = [];
  for (const leg of legs) {
    const quote = await api.quote(quoteBody({
      dry: !args.live, swapType: "EXACT_INPUT", originAsset: leg.assetId, destinationAsset: leg.assetId,
      amount: args.amount ?? "1000000", depositType: "ORIGIN_CHAIN", refundTo: address, refundType: "ORIGIN_CHAIN",
      recipient: address, recipientType: "INTENTS",
    }));
    console.log(leg.blockchain, JSON.stringify(summarize(quote), null, 2));
    quotes.push(quote);
  }
  if (args.live) console.log("Fund both deposit addresses from the same wallet, then rerun with --check.");
  return quotes;
}

// 4. Refund to source: merchant's NEAR Intents USDC back out as exact USDT on Tron.
async function test4(api, tokens, args, env) {
  const usdc = findAsset(tokens, "near", "USDC"), usdt = findAsset(tokens, "tron", "USDT");
  const merchant = need(env, "SPIKE_MERCHANT_INTENTS_ACCOUNT");
  const quote = await api.quote(quoteBody({
    dry: !args.live, originAsset: usdc.assetId, destinationAsset: usdt.assetId, amount: args.amount ?? "1000000",
    depositType: "INTENTS", refundTo: merchant, refundType: "INTENTS",
    recipient: need(env, "SPIKE_TRON_REFUND_ADDRESS"), recipientType: "DESTINATION_CHAIN",
  }));
  console.log(JSON.stringify(summarize(quote), null, 2));
  if (!args.live) return quote;
  // For the spike, make the merchant account the 0x address of SPIKE_EVM_PRIVATE_KEY so it can sign erc191.
  const account = await evmAccount(env);
  if (account.address.toLowerCase() !== merchant.toLowerCase()) {
    throw new Error("Live test 4 needs SPIKE_MERCHANT_INTENTS_ACCOUNT to be the SPIKE_EVM_PRIVATE_KEY address");
  }
  return signAndSubmit(api, account, quote.quote.depositAddress);
}

// 5. Escrow questions. Answers need a receiving contract; this checks what 1Click accepts.
async function test5(api, tokens, args, env) {
  const usdt = findAsset(tokens, "tron", "USDT"), usdc = findAsset(tokens, "near", "USDC");
  const quote = await api.quote(quoteBody({
    dry: true, originAsset: usdt.assetId, destinationAsset: usdc.assetId, amount: args.amount ?? "1000000",
    depositType: "ORIGIN_CHAIN", refundTo: need(env, "SPIKE_TRON_REFUND_ADDRESS"), refundType: "ORIGIN_CHAIN",
    recipient: need(env, "SPIKE_ESCROW_ACCOUNT"), recipientType: "DESTINATION_CHAIN",
    extra: { customRecipientMsg: JSON.stringify({ order_id: "spike-order-1" }) },
  }));
  console.log(JSON.stringify(summarize(quote), null, 2));
  console.log("Dry quote only. Whether ft_on_transfer receives this msg must be checked against a deployed receiver.");
  return quote;
}

export async function run(argv, env = process.env, fetcher = fetch) {
  const args = parseArgs(argv);
  const api = client({ apiKey: env.ONECLICK_API_KEY, fetcher });
  // Live (non-dry) quotes are the only path to spending real money: cap them before anything is
  // deposited or signed. MAX_TEST_SPEND_USD is required for --live.
  if (args.live) {
    testSpendCap(env);
    const quote = api.quote;
    api.quote = async body => {
      const result = await quote(body);
      if (body.dry === false) assertTestSpend(result.quote?.amountInUsd, "This quote", env);
      return result;
    };
  }
  if (!env.ONECLICK_API_KEY) console.warn("ONECLICK_API_KEY not set: quotes are unauthenticated and carry an extra 25 bps fee.");
  const tokens = await api.tokens();
  return [test1, test2, test3, test4, test5][args.test - 1](api, tokens, args, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(); } catch {}
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
