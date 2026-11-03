// Cached token catalog. Callers resolve asset IDs here and never hard-code them.
import { IntentsError } from "./errors.ts";
import type { OneClickClient, Token } from "./oneclick.ts";

export interface TokenCatalog {
  all(): Promise<Token[]>;
  byAssetId(assetId: string): Promise<Token | undefined>;
  /** The single token with this symbol on this chain; throws if there is none or more than one. */
  find(blockchain: string, symbol: string): Promise<Token>;
  /** Looks up by contract address; pass null for the chain's native token. */
  byContract(blockchain: string, contractAddress: string | null): Promise<Token | undefined>;
  refresh(): Promise<Token[]>;
}

export function createTokenCatalog(
  client: Pick<OneClickClient, "getTokens">,
  { ttlMs = 5 * 60_000, now = () => Date.now() }: { ttlMs?: number; now?: () => number } = {},
): TokenCatalog {
  let cached: { tokens: Token[]; at: number } | null = null;
  let inFlight: Promise<Token[]> | null = null;

  function refresh(): Promise<Token[]> {
    inFlight ??= client
      .getTokens()
      .then(tokens => {
        cached = { tokens, at: now() };
        return tokens;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function all(): Promise<Token[]> {
    if (cached && now() - cached.at < ttlMs) return cached.tokens;
    try {
      return await refresh();
    } catch (error) {
      // A stale catalog is better than none: asset IDs rarely change, and prices are estimates anyway.
      if (cached) return cached.tokens;
      throw error;
    }
  }

  return {
    all,
    refresh,
    async byAssetId(assetId) {
      return (await all()).find(t => t.assetId === assetId);
    },
    async find(blockchain, symbol) {
      const matches = (await all()).filter(t => t.blockchain === blockchain && t.symbol === symbol);
      if (matches.length !== 1) {
        throw new IntentsError("invalid_request", `Expected one ${symbol} on ${blockchain} in the 1Click catalog, found ${matches.length}`);
      }
      return matches[0]!;
    },
    async byContract(blockchain, contractAddress) {
      const address = contractAddress?.toLowerCase() ?? null;
      return (await all()).find(t => t.blockchain === blockchain && t.contractAddress === address);
    },
  };
}
