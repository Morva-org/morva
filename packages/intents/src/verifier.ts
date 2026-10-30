// Balance reads from the Verifier contract (intents.near) over NEAR RPC. The 1Click Account API
// (/v0/account/balances) needs a per-user session token, so Morva reads the public view methods instead.
import { IntentsError } from "./errors.ts";

export const VERIFIER_CONTRACT = "intents.near";
export const DEFAULT_NEAR_RPC_URL = "https://rpc.mainnet.fastnear.com";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** An EVM wallet's NEAR Intents account is its 0x address ("implicit Eth" account), lowercased. */
export function evmIntentsAccount(address: string): string {
  if (!EVM_ADDRESS.test(address)) throw new IntentsError("invalid_request", `Not an EVM address: ${address}`);
  return address.toLowerCase();
}

export interface VerifierOptions {
  rpcUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  contract?: string;
}

/**
 * Balances held by `accountId` in the Verifier, as a map of token ID to smallest units.
 * With `tokenIds`, returns exactly those IDs (zero included). Without, lists every token the
 * account holds and returns the non-zero ones.
 */
export async function getIntentsBalances(
  accountId: string,
  options: VerifierOptions & { tokenIds?: string[] } = {},
): Promise<Map<string, bigint>> {
  if (!accountId) throw new IntentsError("invalid_request", "accountId is required");
  const view = viewCaller(options);
  let tokenIds = options.tokenIds;
  if (!tokenIds) {
    tokenIds = [];
    const limit = 100;
    for (let from = 0; ; from += limit) {
      const page = await view("mt_tokens_for_owner", { account_id: accountId, from_index: String(from), limit });
      if (!Array.isArray(page)) throw new IntentsError("rpc", "mt_tokens_for_owner did not return an array");
      for (const token of page) {
        const id = (token as { token_id?: unknown })?.token_id;
        if (typeof id !== "string") throw new IntentsError("rpc", "mt_tokens_for_owner returned a token without token_id");
        tokenIds.push(id);
      }
      if (page.length < limit) break;
    }
  }
  if (tokenIds.length === 0) return new Map();

  const balances = await view("mt_batch_balance_of", { account_id: accountId, token_ids: tokenIds });
  if (!Array.isArray(balances) || balances.length !== tokenIds.length) {
    throw new IntentsError("rpc", "mt_batch_balance_of returned the wrong number of balances");
  }
  const result = new Map<string, bigint>();
  tokenIds.forEach((id, i) => {
    const value = balances[i];
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new IntentsError("rpc", `Balance for ${id} is not an integer string`);
    const amount = BigInt(value);
    if (options.tokenIds || amount > 0n) result.set(id, amount);
  });
  return result;
}

function viewCaller({ rpcUrl = DEFAULT_NEAR_RPC_URL, fetch: fetcher = globalThis.fetch, timeoutMs = 20_000, contract = VERIFIER_CONTRACT }: VerifierOptions) {
  return async (method: string, args: unknown): Promise<unknown> => {
    let json: { error?: unknown; result?: { error?: unknown; result?: number[] } };
    try {
      const response = await fetcher(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "morva",
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contract,
            method_name: method,
            args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          },
        }),
      });
      if (!response.ok) throw new IntentsError("rpc", `NEAR RPC returned ${response.status} for ${method}`, { status: response.status });
      json = (await response.json()) as typeof json;
    } catch (cause) {
      if (cause instanceof IntentsError) throw cause;
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new IntentsError(timedOut ? "timeout" : "network", `NEAR RPC ${method} ${timedOut ? "timed out" : "failed"}`, { cause });
    }
    const error = json.error ?? json.result?.error;
    if (error) throw new IntentsError("rpc", `NEAR RPC ${method} failed: ${JSON.stringify(error).slice(0, 300)}`);
    if (!Array.isArray(json.result?.result)) throw new IntentsError("rpc", `NEAR RPC ${method} returned no result bytes`);
    try {
      return JSON.parse(Buffer.from(json.result.result).toString("utf8"));
    } catch (cause) {
      throw new IntentsError("rpc", `NEAR RPC ${method} returned non-JSON`, { cause });
    }
  };
}
