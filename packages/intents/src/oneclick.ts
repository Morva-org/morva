// Typed client for the NEAR Intents 1Click API (https://1click.chaindefuser.com/docs/v0/openapi.yaml).
// Server-only: it carries the partner key. Amounts in and out are bigint smallest units.
import { IntentsError } from "./errors.ts";
import { parseDecimal, priceFromNumber, USD_SCALE } from "./money.ts";

export const ONECLICK_URL = "https://1click.chaindefuser.com";

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT";
export type DepositType = "ORIGIN_CHAIN" | "INTENTS";
export type RefundType = "ORIGIN_CHAIN" | "INTENTS";
export type RecipientType = "INTENTS" | "DESTINATION_CHAIN";
export type Confidentiality = "public" | "basic" | "advanced";
export type ExecutionStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const STATUSES = new Set<string>(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", ...TERMINAL_STATUSES]);

export interface Token {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  /** Lowercased ERC-20 / SPL / etc. address; null for a chain's native token. */
  contractAddress: string | null;
  /** USD per whole token, scaled by 10^PRICE_SCALE. */
  price: bigint;
  priceUpdatedAt: Date;
}

export interface QuoteParams {
  /** Required on purpose: a real quote creates a deposit address, so it is never the default. */
  dry: boolean;
  swapType: SwapType;
  originAsset: string;
  destinationAsset: string;
  /** Input amount for EXACT_INPUT, output amount for EXACT_OUTPUT, in smallest units. */
  amount: bigint;
  depositType: DepositType;
  /** Defaults to match depositType: refunds go back where the funds came from. */
  refundType?: RefundType;
  refundTo: string;
  recipient: string;
  recipientType: RecipientType;
  deadline: Date;
  slippageBps?: number;
  appFees?: { recipient: string; feeBps: number }[];
  confidentiality?: Confidentiality;
  referral?: string;
  quoteWaitingTimeMs?: number;
}

export interface Quote {
  depositAddress: string | null;
  depositMemo: string | null;
  amountIn: bigint;
  minAmountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  amountInUsd: bigint;
  amountOutUsd: bigint;
  deadline: Date | null;
  timeEstimateSeconds: number;
  refundFee: bigint | null;
  withdrawFee: bigint | null;
}

export interface QuoteResult {
  correlationId: string;
  /** 1Click's signature over the quote. Store it with the quote: it is the evidence in a dispute. */
  signature: string;
  timestamp: Date;
  quote: Quote;
  /** The response exactly as received, for storage. */
  raw: unknown;
}

export interface SwapDetails {
  amountIn: bigint | null;
  amountOut: bigint | null;
  depositedAmount: bigint | null;
  refundedAmount: bigint | null;
  refundReason: string | null;
  originChainTxHashes: string[];
  destinationChainTxHashes: string[];
  nearTxHashes: string[];
  intentHashes: string[];
}

export interface StatusResult {
  correlationId: string;
  status: ExecutionStatus;
  updatedAt: Date;
  swapDetails: SwapDetails;
  raw: unknown;
}

export type IntentStandard = "erc191";
export interface UnsignedIntent {
  standard: IntentStandard;
  /** The exact message the wallet signs. */
  payload: string;
}
export interface SignedIntent extends UnsignedIntent {
  /** Verifier encoding, e.g. "secp256k1:<base58>"; see toVerifierErc191Signature. */
  signature: string;
}

export interface OneClickOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface OneClickClient {
  getTokens(): Promise<Token[]>;
  quote(params: QuoteParams): Promise<QuoteResult>;
  getStatus(depositAddress: string, depositMemo?: string): Promise<StatusResult>;
  submitDepositTx(input: { txHash: string; depositAddress: string; nearSenderAccount?: string; memo?: string }): Promise<StatusResult>;
  generateIntent(input: { standard: IntentStandard; signerId: string; depositAddress: string }): Promise<{ intent: UnsignedIntent; correlationId: string }>;
  submitIntent(signed: SignedIntent): Promise<{ intentHash: string; correlationId: string }>;
}

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function createOneClickClient(options: OneClickOptions = {}): OneClickClient {
  const { apiKey, baseUrl = ONECLICK_URL, fetch: fetcher = globalThis.fetch, timeoutMs = 30_000 } = options;
  if (apiKey && typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new IntentsError("invalid_request", "The 1Click partner key is server-only; do not create this client in a browser");
  }

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new IntentsError(timedOut ? "timeout" : "network", `${method} ${path} ${timedOut ? "timed out" : "failed"}`, { path, cause });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new IntentsError("http", `${method} ${path} returned ${response.status}: ${errorMessage(text)}`, {
        status: response.status,
        path,
        body: text.slice(0, 2000),
      });
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new IntentsError("invalid_response", `${method} ${path} returned non-JSON`, { path, body: text.slice(0, 2000), cause });
    }
  }

  const parsing = <T>(path: string, parse: (raw: unknown) => T) => (raw: unknown): T => {
    try {
      return parse(raw);
    } catch (cause) {
      if (cause instanceof IntentsError) throw cause;
      throw new IntentsError("invalid_response", `Unexpected response shape from ${path}: ${(cause as Error).message}`, { path, cause });
    }
  };

  return {
    async getTokens() {
      return parsing("/v0/tokens", parseTokens)(await call("GET", "/v0/tokens"));
    },

    async quote(params) {
      const body = quoteRequestBody(params);
      const result = parsing("/v0/quote", parseQuoteResult)(await call("POST", "/v0/quote", body));
      if (!params.dry && !result.quote.depositAddress) {
        throw new IntentsError("invalid_response", "A real quote came back without a deposit address", { path: "/v0/quote" });
      }
      return result;
    },

    async getStatus(depositAddress, depositMemo) {
      if (!depositAddress) throw new IntentsError("invalid_request", "depositAddress is required");
      const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
      return parsing("/v0/status", parseStatus)(await call("GET", `/v0/status?${query}`));
    },

    async submitDepositTx(input) {
      if (!input.txHash || !input.depositAddress) throw new IntentsError("invalid_request", "txHash and depositAddress are required");
      return parsing("/v0/deposit/submit", parseStatus)(await call("POST", "/v0/deposit/submit", input));
    },

    async generateIntent({ standard, signerId, depositAddress }) {
      if (!signerId || !depositAddress) throw new IntentsError("invalid_request", "signerId and depositAddress are required");
      const raw = await call("POST", "/v0/generate-intent", { type: "swap_transfer", standard, signerId, depositAddress });
      return parsing("/v0/generate-intent", r => {
        const obj = record(r);
        const intent = record(obj.intent);
        if (intent.standard !== standard) throw new Error(`intent.standard is ${String(intent.standard)}`);
        return { intent: { standard, payload: str(intent.payload, "intent.payload") }, correlationId: str(obj.correlationId, "correlationId") };
      })(raw);
    },

    async submitIntent(signed) {
      if (!signed.payload || !signed.signature) throw new IntentsError("invalid_request", "payload and signature are required");
      const raw = await call("POST", "/v0/submit-intent", { type: "swap_transfer", signedData: signed });
      return parsing("/v0/submit-intent", r => {
        const obj = record(r);
        return { intentHash: str(obj.intentHash, "intentHash"), correlationId: str(obj.correlationId, "correlationId") };
      })(raw);
    },
  };
}

export function quoteRequestBody(p: QuoteParams): Record<string, unknown> {
  const fail = (message: string) => {
    throw new IntentsError("invalid_request", message);
  };
  if (typeof p.amount !== "bigint" || p.amount <= 0n) fail("amount must be a positive bigint in smallest units");
  if (!p.refundTo) fail("refundTo is required on every quote");
  if (!p.recipient) fail("recipient is required");
  if (!p.originAsset || !p.destinationAsset) fail("originAsset and destinationAsset are required");
  if (!(p.deadline instanceof Date) || Number.isNaN(p.deadline.getTime())) fail("deadline must be a valid Date");
  const slippageBps = p.slippageBps ?? 100;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) fail("slippageBps must be an integer from 0 to 10000");
  for (const fee of p.appFees ?? []) {
    if (!fee.recipient || !Number.isInteger(fee.feeBps) || fee.feeBps < 0 || fee.feeBps > 10_000) fail("appFees entries need a recipient and an integer feeBps");
  }
  const refundType = p.refundType ?? p.depositType;
  // A NEAR Intents account for an EVM wallet is its lowercase 0x address; 1Click rejects the checksummed form.
  const asIntentsAccount = (account: string) => (/^0x[0-9a-fA-F]{40}$/.test(account) ? account.toLowerCase() : account);
  return {
    dry: p.dry,
    swapType: p.swapType,
    slippageTolerance: slippageBps,
    originAsset: p.originAsset,
    depositType: p.depositType,
    destinationAsset: p.destinationAsset,
    amount: p.amount.toString(),
    refundTo: refundType === "INTENTS" ? asIntentsAccount(p.refundTo) : p.refundTo,
    refundType,
    recipient: p.recipientType === "INTENTS" ? asIntentsAccount(p.recipient) : p.recipient,
    recipientType: p.recipientType,
    deadline: p.deadline.toISOString(),
    quoteWaitingTimeMs: p.quoteWaitingTimeMs ?? 3000,
    ...(p.appFees?.length ? { appFees: p.appFees.map(f => ({ recipient: f.recipient, fee: f.feeBps })) } : {}),
    ...(p.confidentiality ? { confidentiality: p.confidentiality } : {}),
    ...(p.referral ? { referral: p.referral } : {}),
  };
}

// --- response parsing -------------------------------------------------------------------------

function errorMessage(text: string): string {
  try {
    const message = (JSON.parse(text) as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join("; ");
  } catch {}
  return text.slice(0, 300) || "(empty body)";
}

function record(value: unknown, name = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} is not an object`);
  return value as Record<string, unknown>;
}
function str(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${name} is missing`);
  return value;
}
function optStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
function units(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${name} is not an integer string`);
  return BigInt(value);
}
function optUnits(value: unknown, name: string): bigint | null {
  return value === undefined || value === null || value === "" ? null : units(value, name);
}
function usd(value: unknown): bigint {
  return typeof value === "string" && value !== "" ? parseDecimal(value, USD_SCALE) : 0n;
}
function date(value: unknown, name: string): Date {
  const d = new Date(str(value, name));
  if (Number.isNaN(d.getTime())) throw new Error(`${name} is not a date`);
  return d;
}

/** Malformed catalog entries are dropped rather than failing the whole catalog. */
export function parseTokens(raw: unknown): Token[] {
  if (!Array.isArray(raw)) throw new Error("token list is not an array");
  const tokens: Token[] = [];
  for (const entry of raw) {
    try {
      const t = record(entry, "token");
      if (!Number.isInteger(t.decimals) || typeof t.price !== "number") continue;
      tokens.push({
        assetId: str(t.assetId, "assetId"),
        blockchain: str(t.blockchain, "blockchain"),
        symbol: str(t.symbol, "symbol"),
        decimals: t.decimals as number,
        contractAddress: optStr(t.contractAddress)?.toLowerCase() ?? null,
        price: priceFromNumber(t.price),
        priceUpdatedAt: date(t.priceUpdatedAt, "priceUpdatedAt"),
      });
    } catch {
      continue;
    }
  }
  return tokens;
}

export function parseQuoteResult(raw: unknown): QuoteResult {
  const obj = record(raw);
  const q = record(obj.quote, "quote");
  return {
    correlationId: str(obj.correlationId, "correlationId"),
    signature: str(obj.signature, "signature"),
    timestamp: date(obj.timestamp, "timestamp"),
    quote: {
      depositAddress: optStr(q.depositAddress),
      depositMemo: optStr(q.depositMemo),
      amountIn: units(q.amountIn, "amountIn"),
      minAmountIn: units(q.minAmountIn, "minAmountIn"),
      amountOut: units(q.amountOut, "amountOut"),
      minAmountOut: units(q.minAmountOut, "minAmountOut"),
      amountInUsd: usd(q.amountInUsd),
      amountOutUsd: usd(q.amountOutUsd),
      deadline: q.deadline ? date(q.deadline, "deadline") : null,
      timeEstimateSeconds: typeof q.timeEstimate === "number" ? q.timeEstimate : 0,
      refundFee: optUnits(q.refundFee, "refundFee"),
      withdrawFee: optUnits(q.withdrawFee, "withdrawFee"),
    },
    raw,
  };
}

export function parseStatus(raw: unknown): StatusResult {
  const obj = record(raw);
  const status = str(obj.status, "status");
  if (!STATUSES.has(status)) throw new Error(`unknown status ${status}`);
  const d = obj.swapDetails === undefined || obj.swapDetails === null ? {} : record(obj.swapDetails, "swapDetails");
  const hashes = (value: unknown) =>
    Array.isArray(value) ? value.map(h => (typeof h === "string" ? h : optStr(record(h, "tx").hash))).filter((h): h is string => !!h) : [];
  return {
    correlationId: str(obj.correlationId, "correlationId"),
    status: status as ExecutionStatus,
    updatedAt: date(obj.updatedAt, "updatedAt"),
    swapDetails: {
      amountIn: optUnits(d.amountIn, "amountIn"),
      amountOut: optUnits(d.amountOut, "amountOut"),
      depositedAmount: optUnits(d.depositedAmount, "depositedAmount"),
      refundedAmount: optUnits(d.refundedAmount, "refundedAmount"),
      refundReason: optStr(d.refundReason),
      originChainTxHashes: hashes(d.originChainTxHashes),
      destinationChainTxHashes: hashes(d.destinationChainTxHashes),
      nearTxHashes: hashes(d.nearTxHashes),
      intentHashes: hashes(d.intentHashes),
    },
    raw,
  };
}
