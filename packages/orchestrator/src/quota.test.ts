import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { QuotaManager } from './quota.js';

/**
 * QuotaManager is exercised against an in-process Redis via ioredis-mock.
 * The mock's Lua engine (lua-in-js) supports the subset of commands our
 * LUA_CONSUME script touches (HSET/HGET/HINCRBY/DEL/PEXPIRE/EXISTS).
 *
 * We use 'api-sports' throughout — SOURCES['api-sports'] has dailyCap=100,
 * perMinuteCap=10, which is a convenient capped tier-2 source for tests.
 */

const TIER2_SOURCE_ID = 'api-sports';
const TIER2_DAILY = 100;
const TIER2_PER_MIN = 10;

const UNLIMITED_DAILY_SOURCE = 'sportsrc';  // dailyCap=0, perMinute=60

describe('QuotaManager', () => {
  let redis: Redis;
  let quota: QuotaManager;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    quota = new QuotaManager(redis);
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('allows the first consume and deducts one token', async () => {
    const res = await quota.consume(TIER2_SOURCE_ID);
    expect(res.allowed).toBe(true);
    if (res.allowed) {
      expect(res.dayRemaining).toBe(TIER2_DAILY - 1);
      expect(res.minuteRemaining).toBe(TIER2_PER_MIN - 1);
    }
  });

  it('blocks once per-minute cap is exhausted', async () => {
    for (let i = 0; i < TIER2_PER_MIN; i += 1) {
      const ok = await quota.consume(TIER2_SOURCE_ID);
      expect(ok.allowed).toBe(true);
    }
    const blocked = await quota.consume(TIER2_SOURCE_ID);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('minute');
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('blocks once daily cap is exhausted — minute bucket bypassed by resets', async () => {
    // Consume 100 tokens across multiple "minutes" by manually resetting
    // the minute bucket between bursts.
    const drain = async () => {
      for (let i = 0; i < TIER2_PER_MIN; i += 1) {
        await quota.consume(TIER2_SOURCE_ID);
      }
      // Force-expire the minute bucket
      await redis.del(`quota:${TIER2_SOURCE_ID}:min`);
    };

    const needed = Math.ceil(TIER2_DAILY / TIER2_PER_MIN);
    for (let i = 0; i < needed; i += 1) {
      await drain();
    }

    const blocked = await quota.consume(TIER2_SOURCE_ID);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('day');
    }
  });

  it('treats dailyCap = 0 as unlimited', async () => {
    for (let i = 0; i < 20; i += 1) {
      const r = await quota.consume(UNLIMITED_DAILY_SOURCE);
      expect(r.allowed).toBe(true);
      if (r.allowed) {
        expect(r.dayRemaining).toBe(-1);
      }
    }
  });

  it('getStatus reports cap/used/reset', async () => {
    await quota.consume(TIER2_SOURCE_ID);
    await quota.consume(TIER2_SOURCE_ID);
    const status = await quota.getStatus(TIER2_SOURCE_ID);
    expect(status.day.cap).toBe(TIER2_DAILY);
    expect(status.day.used).toBe(2);
    expect(status.minute.used).toBe(2);
    expect(status.day.resetAt).toBeGreaterThan(Date.now());
  });

  it('deductDatapoints charges the overage', async () => {
    await quota.consume(TIER2_SOURCE_ID);              // daily used = 1
    await quota.deductDatapoints(TIER2_SOURCE_ID, 5);  // charge 4 more (5 total)
    const status = await quota.getStatus(TIER2_SOURCE_ID);
    expect(status.day.used).toBe(5);
  });

  it('deductDatapoints is a no-op when points <= 1', async () => {
    await quota.consume(TIER2_SOURCE_ID);
    await quota.deductDatapoints(TIER2_SOURCE_ID, 1);
    const status = await quota.getStatus(TIER2_SOURCE_ID);
    expect(status.day.used).toBe(1);
  });

  it('resetDaily clears the daily bucket', async () => {
    await quota.consume(TIER2_SOURCE_ID);
    await quota.resetDaily(TIER2_SOURCE_ID);
    const status = await quota.getStatus(TIER2_SOURCE_ID);
    expect(status.day.used).toBe(0);
  });

  it('dailyUsedFraction returns 0 for unlimited sources', async () => {
    await quota.consume(UNLIMITED_DAILY_SOURCE);
    expect(await quota.dailyUsedFraction(UNLIMITED_DAILY_SOURCE)).toBe(0);
  });

  it('dailyUsedFraction tracks usage correctly', async () => {
    for (let i = 0; i < 10; i += 1) {
      await quota.consume(TIER2_SOURCE_ID);
    }
    const frac = await quota.dailyUsedFraction(TIER2_SOURCE_ID);
    expect(frac).toBeCloseTo(0.1, 5);
  });
});
