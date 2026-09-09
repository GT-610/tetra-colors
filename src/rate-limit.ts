interface RateBucket {
  startedAt: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxBuckets: number,
  ) {
    if (windowMs <= 0 || maxBuckets <= 0) {
      throw new Error("Rate limiter bounds must be positive");
    }
  }

  consume(key: string, limit: number, now = Date.now()): boolean {
    if (limit <= 0) return false;

    const bucket = this.buckets.get(key);
    if (bucket && now - bucket.startedAt < this.windowMs) {
      bucket.count += 1;
      return bucket.count <= limit;
    }

    if (bucket) {
      this.buckets.delete(key);
    } else if (this.buckets.size >= this.maxBuckets) {
      for (const [bucketKey, candidate] of this.buckets) {
        if (now - candidate.startedAt >= this.windowMs) {
          this.buckets.delete(bucketKey);
        }
      }
      // Prefer availability over strictness once every bucket is active: evict
      // the oldest bucket instead of rejecting new callers outright, so a burst
      // of distinct keys can no longer lock legitimate users out entirely.
      if (this.buckets.size >= this.maxBuckets) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
    }

    this.buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
}
