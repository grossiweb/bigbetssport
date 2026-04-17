import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@bbs/shared';
import { requireSource } from './sources/registry.js';

/**
 * Quota manager — atomic token-bucket tracker for per-source daily and
 * per-minute caps. All check-and-consume logic runs inside a single Redis
 * Lua script so two concurrent workers cannot both slip past an exhausted
 * bucket.
 *
 * Per-bucket state (Redis HASH):
 *   cap       — declared cap (0 = unlimited)
 *   used      — tokens consumed in the current window
 *   reset_at  — epoch-ms when this window resets
 */

export const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MINUTE_WINDOW_MS = 60 * 1000;

export type ConsumeResult =
  | { readonly allowed: true; readonly dayRemaining: number; readonly minuteRemaining: number }
  | {
      readonly allowed: false;
      readonly retryAfterMs: number;
      readonly reason: 'day' | 'minute';
    };

export interface BucketStatus {
  readonly cap: number;
  readonly used: number;
  readonly resetAt: number;
}

export interface QuotaStatus {
  readonly sourceId: string;
  readonly day: BucketStatus;
  readonly minute: BucketStatus;
}

/**
 * KEYS[1] = day hash key
 * KEYS[2] = minute hash key
 * ARGV[1] = default day cap (from SourceConfig)
 * ARGV[2] = default minute cap
 * ARGV[3] = now (epoch ms)
 * ARGV[4] = day window ms
 * ARGV[5] = minute window ms
 *
 * Returns:
 *   { allowed, retryAfterMs, dayRemaining, minuteRemaining, reason }
 *     allowed:            1 = consumed, 0 = rejected
 *     retryAfterMs:       0 on success; otherwise ms until the blocking bucket resets
 *     dayRemaining / minuteRemaining: tokens left AFTER this call (-1 = unlimited)
 *     reason:             "ok" | "day" | "minute"
 *
 * The script is re-entrant — repeated calls with the same `now` are
 * idempotent only up to the increment (each call still consumes one token).
 */
export const LUA_CONSUME = `
local day_key = KEYS[1]
local min_key = KEYS[2]
local default_day_cap = tonumber(ARGV[1])
local default_min_cap = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local day_window = tonumber(ARGV[4])
local min_window = tonumber(ARGV[5])

-- Ensure day bucket
local day_cap
local day_used
local day_reset
if redis.call('EXISTS', day_key) == 0 then
  redis.call('HSET', day_key, 'cap', tostring(default_day_cap), 'reset_at', tostring(now + day_window))
  redis.call('PEXPIRE', day_key, day_window)
  day_cap = default_day_cap
  day_used = 0
  day_reset = now + day_window
else
  day_reset = tonumber(redis.call('HGET', day_key, 'reset_at')) or 0
  if day_reset <= now then
    redis.call('DEL', day_key)
    redis.call('HSET', day_key, 'cap', tostring(default_day_cap), 'reset_at', tostring(now + day_window))
    redis.call('PEXPIRE', day_key, day_window)
    day_cap = default_day_cap
    day_used = 0
    day_reset = now + day_window
  else
    day_cap = tonumber(redis.call('HGET', day_key, 'cap')) or default_day_cap
    day_used = tonumber(redis.call('HGET', day_key, 'used')) or 0
  end
end

-- Ensure minute bucket
local min_cap
local min_used
local min_reset
if redis.call('EXISTS', min_key) == 0 then
  redis.call('HSET', min_key, 'cap', tostring(default_min_cap), 'reset_at', tostring(now + min_window))
  redis.call('PEXPIRE', min_key, min_window)
  min_cap = default_min_cap
  min_used = 0
  min_reset = now + min_window
else
  min_reset = tonumber(redis.call('HGET', min_key, 'reset_at')) or 0
  if min_reset <= now then
    redis.call('DEL', min_key)
    redis.call('HSET', min_key, 'cap', tostring(default_min_cap), 'reset_at', tostring(now + min_window))
    redis.call('PEXPIRE', min_key, min_window)
    min_cap = default_min_cap
    min_used = 0
    min_reset = now + min_window
  else
    min_cap = tonumber(redis.call('HGET', min_key, 'cap')) or default_min_cap
    min_used = tonumber(redis.call('HGET', min_key, 'used')) or 0
  end
end

if day_cap > 0 and day_used >= day_cap then
  return {0, day_reset - now, -1, -1, 'day'}
end
if min_cap > 0 and min_used >= min_cap then
  return {0, min_reset - now, -1, -1, 'minute'}
end

redis.call('HINCRBY', day_key, 'used', 1)
redis.call('HINCRBY', min_key, 'used', 1)

local day_remaining = -1
if day_cap > 0 then day_remaining = day_cap - day_used - 1 end
local min_remaining = -1
if min_cap > 0 then min_remaining = min_cap - min_used - 1 end

return {1, 0, day_remaining, min_remaining, 'ok'}
`;

const COMMAND_NAME = 'bbsQuotaConsume';

/** Narrow type for the array tuple `LUA_CONSUME` returns. */
type ConsumeReturn = [number, number, number, number, string];

/**
 * Extend `Redis` locally with the custom command. We don't modify the global
 * `Redis` type; we just locally cast when we call the command.
 */
interface RedisWithConsume {
  bbsQuotaConsume(
    dayKey: string,
    minKey: string,
    dayCap: string,
    minCap: string,
    now: string,
    dayWindowMs: string,
    minWindowMs: string,
  ): Promise<ConsumeReturn>;
}

function defineOnce(redis: Redis): void {
  // `defineCommand` is idempotent in ioredis, but calling it on every
  // instance we touch adds allocations. Stash a sentinel on the client.
  const tagged = redis as unknown as { __bbsQuotaConsumeDefined?: boolean };
  if (tagged.__bbsQuotaConsumeDefined) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 2, lua: LUA_CONSUME });
  tagged.__bbsQuotaConsumeDefined = true;
}

export class QuotaManager {
  constructor(private readonly redis: Redis) {
    defineOnce(redis);
  }

  /**
   * Atomic check-and-deduct. Returns `{ allowed: true, ...remaining }` on
   * success, or `{ allowed: false, retryAfterMs, reason }` when either the
   * daily or minute bucket is exhausted.
   */
  async consume(sourceId: string): Promise<ConsumeResult> {
    const source = requireSource(sourceId);
    const now = Date.now();

    const result = (await (this.redis as unknown as RedisWithConsume).bbsQuotaConsume(
      REDIS_KEYS.quotaDay(sourceId),
      REDIS_KEYS.quotaMin(sourceId),
      String(source.dailyCap),
      String(source.perMinuteCap),
      String(now),
      String(DAY_WINDOW_MS),
      String(MINUTE_WINDOW_MS),
    )) as ConsumeReturn;

    const [allowed, retryAfterMs, dayRemaining, minuteRemaining, reason] = result;

    if (allowed === 1) {
      return {
        allowed: true,
        dayRemaining: Number(dayRemaining),
        minuteRemaining: Number(minuteRemaining),
      };
    }
    return {
      allowed: false,
      retryAfterMs: Number(retryAfterMs),
      reason: reason === 'day' ? 'day' : 'minute',
    };
  }

  /**
   * Snapshot current usage for monitoring. Read-only; no mutation.
   */
  async getStatus(sourceId: string): Promise<QuotaStatus> {
    const dayKey = REDIS_KEYS.quotaDay(sourceId);
    const minKey = REDIS_KEYS.quotaMin(sourceId);
    const source = getSourceOrEmpty(sourceId);

    const [dayHash, minHash] = await Promise.all([
      this.redis.hgetall(dayKey),
      this.redis.hgetall(minKey),
    ]);

    return {
      sourceId,
      day: hashToBucket(dayHash, source.dailyCap),
      minute: hashToBucket(minHash, source.perMinuteCap),
    };
  }

  /**
   * Deduct extra datapoints after a successful call. Used by sources whose
   * quota is billed by datapoints, not requests (e.g. TheRundown).
   *
   * This is called AFTER `consume`, which already deducted 1. Pass
   * `datapointsUsed` as the TOTAL charge so we can deduct the remaining
   * `(datapointsUsed - 1)` tokens.
   */
  async deductDatapoints(sourceId: string, points: number): Promise<void> {
    if (!Number.isFinite(points) || points <= 1) return;
    const extra = Math.floor(points - 1);
    if (extra <= 0) return;
    await this.redis.hincrby(REDIS_KEYS.quotaDay(sourceId), 'used', extra);
  }

  /**
   * Force-reset the daily bucket. Called by the midnight-UTC scheduled
   * job, or manually when unblocking a source.
   */
  async resetDaily(sourceId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.quotaDay(sourceId));
  }

  /**
   * Cheap read — used by `applyAutoSuspension`. Returns a 0..1 fraction.
   * For unlimited sources (dailyCap = 0) always returns 0.
   */
  async dailyUsedFraction(sourceId: string): Promise<number> {
    const status = await this.getStatus(sourceId);
    if (status.day.cap <= 0) return 0;
    return status.day.used / status.day.cap;
  }
}

function getSourceOrEmpty(sourceId: string): { dailyCap: number; perMinuteCap: number } {
  try {
    const s = requireSource(sourceId);
    return { dailyCap: s.dailyCap, perMinuteCap: s.perMinuteCap };
  } catch {
    return { dailyCap: 0, perMinuteCap: 0 };
  }
}

function hashToBucket(
  hash: Record<string, string>,
  defaultCap: number,
): BucketStatus {
  return {
    cap: Number(hash['cap'] ?? defaultCap),
    used: Number(hash['used'] ?? 0),
    resetAt: Number(hash['reset_at'] ?? 0),
  };
}
