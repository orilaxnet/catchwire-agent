interface Bucket {
  count:   number;
  resetAt: number;
}

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  llm_requests:  { max: 60,  windowMs: 60_000  },
  email_send:    { max: 20,  windowMs: 60_000  },
  telegram_msgs: { max: 30,  windowMs: 60_000  },
  api_calls:     { max: 100, windowMs: 60_000  },
  auth_attempts: { max: 5,   windowMs: 300_000 },
};

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /** true = allowed, false = rate limited */
  check(key: string, limitName: string): boolean {
    const limit  = LIMITS[limitName];
    if (!limit) return true;

    const now    = Date.now();
    const mapKey = `${key}:${limitName}`;
    const bucket = this.buckets.get(mapKey);

    if (!bucket || bucket.resetAt < now) {
      this.buckets.set(mapKey, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (bucket.count >= limit.max) return false;
    bucket.count++;
    return true;
  }
}
