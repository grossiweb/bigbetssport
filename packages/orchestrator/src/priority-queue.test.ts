import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { PriorityQueueManager, tierForField } from './priority-queue.js';

/**
 * We stub out BullMQ's `Queue` class before instantiating the manager —
 * BullMQ does real Redis work in its constructor that ioredis-mock doesn't
 * fully emulate. The queue behaviour itself isn't what we're testing here;
 * suspension + auto-suspension logic is.
 */
vi.mock('bullmq', () => {
  return {
    Queue: class MockQueue {
      public readonly name: string;
      constructor(name: string) {
        this.name = name;
      }
      on(): this {
        return this;
      }
      async add(): Promise<{ id: string }> {
        return { id: 'mock-job-id' };
      }
      async close(): Promise<void> {
        /* noop */
      }
    },
  };
});

const SRC = 'api-sports';

describe('tierForField', () => {
  it('maps scores to P0', () => expect(tierForField('scores')).toBe('P0'));
  it('maps odds/lineups/injuries/xg to P1', () => {
    expect(tierForField('odds')).toBe('P1');
    expect(tierForField('lineups')).toBe('P1');
    expect(tierForField('injuries')).toBe('P1');
    expect(tierForField('xg')).toBe('P1');
  });
  it('maps stats/historical/transfers/standings/players to P2', () => {
    expect(tierForField('stats')).toBe('P2');
    expect(tierForField('historical')).toBe('P2');
    expect(tierForField('transfers')).toBe('P2');
    expect(tierForField('standings')).toBe('P2');
    expect(tierForField('players')).toBe('P2');
  });
});

describe('PriorityQueueManager — suspension', () => {
  let redis: Redis;
  let pqm: PriorityQueueManager;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    pqm = new PriorityQueueManager(redis);
  });

  afterEach(async () => {
    await pqm.close();
    await redis.quit();
  });

  it('suspend / resume round-trip', async () => {
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(false);
    await pqm.suspend(SRC, 'P1');
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(true);
    await pqm.resume(SRC, 'P1');
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(false);
  });

  it('markFailover / isFailedOver round-trip', async () => {
    expect(await pqm.isFailedOver(SRC)).toBe(false);
    await pqm.markFailover(SRC);
    expect(await pqm.isFailedOver(SRC)).toBe(true);
  });
});

describe('PriorityQueueManager.applyAutoSuspension', () => {
  let redis: Redis;
  let pqm: PriorityQueueManager;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    pqm = new PriorityQueueManager(redis);
  });

  afterEach(async () => {
    await pqm.close();
    await redis.quit();
  });

  it('usedPct < 0.90 → no tier suspended', async () => {
    await pqm.applyAutoSuspension(SRC, 0.5);
    expect(await pqm.isSuspended(SRC, 'P0')).toBe(false);
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(false);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(false);
    expect(await pqm.isFailedOver(SRC)).toBe(false);
  });

  it('usedPct >= 0.90 → P2 suspended', async () => {
    await pqm.applyAutoSuspension(SRC, 0.91);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(true);
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(false);
    expect(await pqm.isSuspended(SRC, 'P0')).toBe(false);
  });

  it('usedPct >= 0.95 → P1 and P2 suspended, P0 still allowed', async () => {
    await pqm.applyAutoSuspension(SRC, 0.96);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(true);
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(true);
    expect(await pqm.isSuspended(SRC, 'P0')).toBe(false);
    expect(await pqm.isFailedOver(SRC)).toBe(false);
  });

  it('usedPct >= 1.0 → all tiers suspended + failover marked', async () => {
    await pqm.applyAutoSuspension(SRC, 1.0);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(true);
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(true);
    expect(await pqm.isSuspended(SRC, 'P0')).toBe(true);
    expect(await pqm.isFailedOver(SRC)).toBe(true);
  });

  it('recovers when usage drops back below 0.90', async () => {
    await pqm.applyAutoSuspension(SRC, 0.96);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(true);

    await pqm.applyAutoSuspension(SRC, 0.5);
    expect(await pqm.isSuspended(SRC, 'P2')).toBe(false);
    expect(await pqm.isSuspended(SRC, 'P1')).toBe(false);
    expect(await pqm.isSuspended(SRC, 'P0')).toBe(false);
  });
});
