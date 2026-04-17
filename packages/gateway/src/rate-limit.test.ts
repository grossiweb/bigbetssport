import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { checkAndConsume, peek, type PlanLimits } from './rate-limit.js';

const FREE: PlanLimits = { perMinute: 100, perDay: 1_000 };
const ENTERPRISE: PlanLimits = {
  perMinute: Number.POSITIVE_INFINITY,
  perDay: Number.POSITIVE_INFINITY,
};

describe('checkAndConsume — dual bucket', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('allows the first call and reports minute + day remaining', async () => {
    const res = await checkAndConsume(redis, 'k-1', FREE);
    expect(res.allowed).toBe(true);
    expect(res.minute.used).toBe(1);
    expect(res.minute.remaining).toBe(99);
    expect(res.day.used).toBe(1);
    expect(res.day.remaining).toBe(999);
  });

  it('rejects once minute bucket is full (100/min on free)', async () => {
    for (let i = 0; i < 100; i += 1) {
      const r = await checkAndConsume(redis, 'k-m', FREE);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndConsume(redis, 'k-m', FREE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitingBucket).toBe('minute');
    expect(blocked.limit).toBe(100);
    expect(blocked.remaining).toBe(0);
  });

  it('rejects once day bucket is full, even when minute is empty', async () => {
    // Use a tiny synthetic plan so we can exhaust the day bucket without
    // drumming 1000 times.
    const TINY: PlanLimits = { perMinute: 10, perDay: 3 };
    expect((await checkAndConsume(redis, 'k-d', TINY)).allowed).toBe(true);
    expect((await checkAndConsume(redis, 'k-d', TINY)).allowed).toBe(true);
    expect((await checkAndConsume(redis, 'k-d', TINY)).allowed).toBe(true);
    const blocked = await checkAndConsume(redis, 'k-d', TINY);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitingBucket).toBe('day');
    expect(blocked.day.remaining).toBe(0);
    // resetAt should point into the future (next UTC midnight).
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });

  it('enterprise plan bypasses both buckets', async () => {
    for (let i = 0; i < 50; i += 1) {
      const r = await checkAndConsume(redis, 'k-e', ENTERPRISE);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('tighter bucket is reported as limitingBucket on allowed calls', async () => {
    // With perDay=1000 and perMinute=100, the MINUTE bucket runs out first
    // for the first minute, so it should be the tighter one.
    const r = await checkAndConsume(redis, 'k-t', FREE);
    expect(r.limitingBucket).toBe('minute');
    expect(r.remaining).toBe(99);
  });

  it('peek reports both bucket states without consuming', async () => {
    await checkAndConsume(redis, 'k-p', FREE);
    await checkAndConsume(redis, 'k-p', FREE);
    const snap = await peek(redis, 'k-p', FREE);
    expect(snap.minute.used).toBe(2);
    expect(snap.day.used).toBe(2);
    expect(snap.minute.remaining).toBe(98);
    expect(snap.day.remaining).toBe(998);

    // Peek shouldn't have incremented.
    const after = await peek(redis, 'k-p', FREE);
    expect(after.minute.used).toBe(2);
  });

  it('includes per-bucket reset timestamps', async () => {
    const now = Date.now();
    const r = await checkAndConsume(redis, 'k-r', FREE, now);
    expect(r.minute.resetAt).toBe(now + 60_000);
    // Day reset is the next UTC midnight; should be strictly > minute reset.
    expect(r.day.resetAt).toBeGreaterThan(r.minute.resetAt);
  });
});
