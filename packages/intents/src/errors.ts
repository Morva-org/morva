export type IntentsErrorKind =
  | "http" // the API answered with a non-2xx status
  | "network" // the request never got an answer
  | "timeout"
  | "invalid_response" // a 2xx body that does not match the documented shape
  | "rpc" // NEAR RPC or Verifier view call failed
  | "invalid_request"; // rejected locally before any request was sent

export class IntentsError extends Error {
  readonly kind: IntentsErrorKind;
  readonly status?: number;
  readonly path?: string;
  readonly body?: string;
  /** Smallest amount 1Click will route, when it rejected a quote as too small ("try at least N"). */
  readonly minAmount?: bigint;

  constructor(kind: IntentsErrorKind, message: string, details: { status?: number; path?: string; body?: string; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = "IntentsError";
    this.kind = kind;
    this.status = details.status;
    this.path = details.path;
    this.body = details.body;
    const minimum = /too low.*try at least (\d+)/i.exec(message);
    if (minimum) this.minAmount = BigInt(minimum[1]!);
  }
}
