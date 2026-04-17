import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { CB_DEFAULTS, CircuitBreaker, shouldOpen } from './circuit-breaker.js';
import { REDIS_KEYS } from '@bbs/shared';

const SRC = 'test-source';

describe('shouldOpen', () => {
  it('stays closed below threshold', () => {
    expect(shouldOpen(0, 3)).toBe(false);
    expect(shouldOpen(2, 3)).toBe(false);
  });
  it('opens at or above threshold', () => {
    expect(shouldOpen(3, 3)).toBe(true);
    expect(shouldOpen(99, 3)).toBe(true);
  });
});

describe('CircuitBreaker', () => {
  let redis: Redis;
  let cb: CircuitBreaker;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    cb = new CircuitBreaker(redis, SRC, {
      failureThreshold: 3,
      cooldownMs: 200,
      halfOpenProbes: 1,
    });
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('starts closed and allows requests', async () => {
    expect(await cb.getState()).toBe('closed');
    expect(await cb.allowRequest()).toBe(true);
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const r1 = await cb.recordFailure();
    expect(r1.opened).toBe(false);
    const r2 = await cb.recordFailure();
    expect(r2.opened).toBe(false);
    const r3 = await cb.recordFailure();
    expect(r3.opened).toBe(true);

    expect(await cb.getState()).toBe('open');
    expect(await cb.allowRequest()).toBe(false);
  });

  it('enters half-open after cooldown elapses', async () => {
    await cb.recordFailure();
    await cb.recordFailure();
    await cb.recordFailure();
    expect(await cb.getState()).toBe('open');

    // Wait for cooldown TTL to elapse. Mock supports PX TTLs via timers.
    await new Promise((r) => setTimeout(r, 250));

    // First request after cooldown probes — should be allowed
    const allowed = await cb.allowRequest();
    expect(allowed).toBe(true);
    expect(await cb.getState()).toBe('half-open');
  });

  it('rejects concurrent probes in half-open (halfOpenProbes=1)', async () => {
    await cb.recordFailure();
    await cb.recordFailure();
    await cb.recordFailure();
    await new Promise((r) => setTimeout(r, 250));

    const first = await cb.allowRequest();
    const second = await cb.allowRequest();
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('closes on probe success', async () => {
    await cb.recordFailure();
    await cb.recordFailure();
    await cb.recordFailure();
    await new Promise((r) => setTimeout(r, 250));
    await cb.allowRequest();
    expect(await cb.getState()).toBe('half-open');

    await cb.recordSuccess();
    expect(await cb.getState()).toBe('closed');
    expect(await cb.allowRequest()).toBe(true);
  });

  it('re-opens on probe failure', async () => {
    await cb.recordFailure();
    await cb.recordFailure();
    await cb.recordFailure();
    await new Promise((r) => setTimeout(r, 250));
    await cb.allowRequest();
    expect(await cb.getState()).toBe('half-open');

    const { opened } = await cb.recordFailure();
    expect(opened).toBe(true);
    expect(await cb.getState()).toBe('open');
  });

  it('reset clears all state', async () => {
    await cb.recordFailure();
    await cb.recordFailure();
    await cb.recordFailure();
    expect(await cb.getState()).toBe('open');

    await cb.reset();
    expect(await cb.getState()).toBe('closed');
    expect(await redis.get(REDIS_KEYS.cb(SRC))).toBeNull();
    expect(await redis.get(REDIS_KEYS.cbFails(SRC))).toBeNull();
  });

  it('honours CB_DEFAULTS exports', () => {
    expect(CB_DEFAULTS.failureThreshold).toBe(3);
    expect(CB_DEFAULTS.cooldownMs).toBe(60_000);
    expect(CB_DEFAULTS.halfOpenProbes).toBe(1);
  });
});
