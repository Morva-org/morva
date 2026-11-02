// Fixed-window rate limits, in memory. Fine for one API instance; move to Postgres or Redis
// before running more than one.

export interface Limit {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Counts one hit for `key`. Returns the seconds to wait if the limit is exceeded. */
  hit(key: string, limit: Limit): { ok: true } | { ok: false; retryAfter: number } {
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + limit.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit.max) return { ok: false, retryAfter: Math.ceil((entry.resetAt - t) / 1000) };
    if (this.hits.size > 50_000) this.sweep(t);
    return { ok: true };
  }

  private sweep(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

export const LIMITS = {
  register: { max: 10, windowMs: 60 * 60_000 },
  login: { max: 30, windowMs: 10 * 60_000 },
  emailSend: { max: 5, windowMs: 60 * 60_000 },
  emailVerify: { max: 10, windowMs: 10 * 60_000 },
  handleCheck: { max: 120, windowMs: 60_000 },
} satisfies Record<string, Limit>;
