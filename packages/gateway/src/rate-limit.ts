import type { Redis } from 'ioredis';

/**
 * Dual-bucket (per-minute + per-day) rate limiter.
 *
 * Minute bucket — Redis ZSET sliding window. Each call ZADDs a timestamped
 * member, ZREMRANGEBYSCOREs entries older than 60s, and ZCARDs the result.
 * Accurate under burst traffic; bounded memory (≤ perMinute entries).
 *
 * Day bucket — Redis INCR with a daily key `ratelimit:{keyId}:day:{YYYYMMDD}`.
 * Fixed-window (UTC). Preferred over ZSET for daily precision because a
 * 500k-entry ZSET would balloon memory on the pro plan.
 *
 * Enterprise plan (both limits === Infinity) bypasses both buckets entirely.
 */

import type { PlanLimits } from './key-store.js';

const MINUTE_WINDOW_MS = 60_000;

export interface BucketSnapshot {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
}

export interface RateCheckResult {
  readonly allowed: boolean;
  /** Which bucket rejected (or is tighter on allowed). */
  readonly limitingBucket: 'minute' | 'day';
  readonly limit: number;
  readonly remaining: number;
  /** Epoch ms at which the rejecting / tighter bucket fully resets. */
  readonly resetAt: number;
  readonly minute: BucketSnapshot;
  readonly day: BucketSnapshot;
}

function minuteKey(keyId: string): string {
  return `ratelimit:${keyId}:min`;
}

function dayKey(keyId: string, now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `ratelimit:${keyId}:day:${y}${m}${day}`;
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

function unlimited(now: number): RateCheckResult {
  const minuteReset = now + MINUTE_WINDOW_MS;
  const dayReset = nextUtcMidnight(now);
  const unbounded: BucketSnapshot = {
    used: 0,
    limit: Number.POSITIVE_INFINITY,
    remaining: Number.POSITIVE_INFINITY,
    resetAt: minuteReset,
  };
  return {
    allowed: true,
    limitingBucket: 'minute',
    limit: Number.POSITIVE_INFINITY,
    remaining: Number.POSITIVE_INFINITY,
    resetAt: minuteReset,
    minute: unbounded,
    day: { ...unbounded, resetAt: dayReset },
  };
}

/**
 * Atomic-ish check-and-consume against both buckets.
 *
 *   1. Peek the minute ZSET (trim + ZCARD).
 *   2. Peek the day INCR counter via GET.
 *   3. Reject if EITHER bucket is exhausted — don't write to either.
 *   4. On allowed: ZADD minute + INCR day.
 *
 * Non-atomic across the two buckets; the race window is sub-millisecond
 * and the worst case is a single extra request slipping through under
 * contention. Headers report the tighter remaining value.
 */
export async function checkAndConsume(
  redis: Redis,
  keyId: string,
  limits: PlanLimits,
  now: number = Date.now(),
): Promise<RateCheckResult> {
  if (!Number.isFinite(limits.perMinute) && !Number.isFinite(limits.perDay)) {
    return unlimited(now);
  }

  const minKey = minuteKey(keyId);
  const dKey = dayKey(keyId, now);
  const minuteReset = now + MINUTE_WINDOW_MS;
  const dayReset = nextUtcMidnight(now);

  await redis.zremrangebyscore(minKey, '-inf', now - MINUTE_WINDOW_MS);
  const minuteUsed = await redis.zcard(minKey);
  const dayRaw = await redis.get(dKey);
  const dayUsed = Number(dayRaw ?? '0');

  const minuteOver = Number.isFinite(limits.perMinute) && minuteUsed >= limits.perMinute;
  const dayOver = Number.isFinite(limits.perDay) && dayUsed >= limits.perDay;

  if (minuteOver || dayOver) {
    const limitingBucket: 'minute' | 'day' = dayOver ? 'day' : 'minute';
    return {
      allowed: false,
      limitingBucket,
      limit: limitingBucket === 'day' ? limits.perDay : limits.perMinute,
      remaining: 0,
      resetAt: limitingBucket === 'day' ? dayReset : minuteReset,
      minute: {
        used: minuteUsed,
        limit: limits.perMinute,
        remaining: Math.max(0, limits.perMinute - minuteUsed),
        resetAt: minuteReset,
      },
      day: {
        used: dayUsed,
        limit: limits.perDay,
        remaining: Math.max(0, limits.perDay - dayUsed),
        resetAt: dayReset,
      },
    };
  }

  await redis.zadd(minKey, now, `${now}-${Math.random()}`);
  await redis.expire(minKey, 120);

  const dayAfter = await redis.incr(dKey);
  if (dayAfter === 1) {
    // First increment in this UTC day — set a 25h TTL so idle keys decay.
    await redis.expire(dKey, 25 * 60 * 60);
  }

  const minuteAfter = minuteUsed + 1;
  const minuteRemaining = Math.max(0, limits.perMinute - minuteAfter);
  const dayRemaining = Math.max(0, limits.perDay - dayAfter);

  const tighterIsDay =
    Number.isFinite(limits.perDay) &&
    (!Number.isFinite(limits.perMinute) || dayRemaining < minuteRemaining);

  return {
    allowed: true,
    limitingBucket: tighterIsDay ? 'day' : 'minute',
    limit: tighterIsDay ? limits.perDay : limits.perMinute,
    remaining: tighterIsDay ? dayRemaining : minuteRemaining,
    resetAt: tighterIsDay ? dayReset : minuteReset,
    minute: {
      used: minuteAfter,
      limit: limits.perMinute,
      remaining: minuteRemaining,
      resetAt: minuteReset,
    },
    day: {
      used: dayAfter,
      limit: limits.perDay,
      remaining: dayRemaining,
      resetAt: dayReset,
    },
  };
}

/**
 * Read-only snapshot used by informational endpoints.
 */
export async function peek(
  redis: Redis,
  keyId: string,
  limits: PlanLimits,
  now: number = Date.now(),
): Promise<Pick<RateCheckResult, 'minute' | 'day'>> {
  await redis.zremrangebyscore(minuteKey(keyId), '-inf', now - MINUTE_WINDOW_MS);
  const minuteUsed = await redis.zcard(minuteKey(keyId));
  const dayRaw = await redis.get(dayKey(keyId, now));
  const dayUsed = Number(dayRaw ?? '0');
  return {
    minute: {
      used: minuteUsed,
      limit: limits.perMinute,
      remaining: Math.max(0, limits.perMinute - minuteUsed),
      resetAt: now + MINUTE_WINDOW_MS,
    },
    day: {
      used: dayUsed,
      limit: limits.perDay,
      remaining: Math.max(0, limits.perDay - dayUsed),
      resetAt: nextUtcMidnight(now),
    },
  };
}
