export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body: unknown } | Error;

/** A fetch stand-in that records requests and answers from a queue. */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("mockFetch: no reply queued");
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

export const QUOTE_RESPONSE = {
  correlationId: "c-1",
  timestamp: "2026-11-02T10:00:00.000Z",
  signature: "ed25519:quote-sig",
  quoteRequest: {},
  quote: {
    depositAddress: "0xdeposit",
    amountIn: "2000000",
    amountInFormatted: "2.0",
    amountInUsd: "1.9989",
    minAmountIn: "2000000",
    amountOut: "1999800",
    amountOutFormatted: "1.9998",
    amountOutUsd: "1.998734",
    minAmountOut: "1979802",
    deadline: "2026-11-02T10:30:00.000Z",
    timeEstimate: 20,
  },
};

export const STATUS_RESPONSE = {
  correlationId: "c-1",
  quoteResponse: QUOTE_RESPONSE,
  status: "SUCCESS",
  updatedAt: "2026-11-02T10:01:00.000Z",
  swapDetails: {
    intentHashes: ["ih"],
    nearTxHashes: ["nh"],
    amountIn: "2000000",
    amountOut: "1999800",
    originChainTxHashes: [{ hash: "0xorigin", explorerUrl: "https://basescan.org/tx/0xorigin" }],
    destinationChainTxHashes: [],
  },
};
