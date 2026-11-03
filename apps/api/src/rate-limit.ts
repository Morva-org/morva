// Fixed-window rate limits, stored in Postgres so they hold across instances and restarts.
import { hitRateLimit, sweepRateLimits, type Db } from "@morva/database";

export interface Limit {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private db: Db;
  private hits = 0;

  constructor(db: Db) {
    this.db = db;
  }

  /** Counts one hit for `key`. Returns the seconds to wait if the limit is exceeded. */
  async hit(key: string, limit: Limit): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
    const { count, resetAt } = await hitRateLimit(this.db, key, limit.windowMs);
    // Expired rows are cleared now and then, off the request's critical path.
    if (++this.hits % 500 === 0) void sweepRateLimits(this.db).catch(() => {});
    if (count > limit.max) return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) };
    return { ok: true };
  }
}

export const LIMITS = {
  register: { max: 10, windowMs: 60 * 60_000 },
  login: { max: 30, windowMs: 10 * 60_000 },
  emailSend: { max: 5, windowMs: 60 * 60_000 },
  emailVerify: { max: 10, windowMs: 10 * 60_000 },
  handleCheck: { max: 120, windowMs: 60_000 },
  onboarding: { max: 120, windowMs: 60_000 },
  logo: { max: 10, windowMs: 60 * 60_000 },
  addDevice: { max: 10, windowMs: 60 * 60_000 },
  relayer: { max: 10, windowMs: 60 * 60_000 },
  testPayment: { max: 20, windowMs: 60 * 60_000 },
  moneyAction: { max: 20, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;
