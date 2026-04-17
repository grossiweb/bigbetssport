import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@bbs/shared';
import { LiveWindowManager } from './live-window-manager.js';
import type { ScheduleFetcher } from './schedule-fetcher.js';
import type { Fixture } from './types.js';

/**
 * Build a stub ScheduleFetcher that returns a scripted response per sport.
 * Only `fetchTodayFixtures` is used by the manager.
 */
function stubFetcher(by: Partial<Record<string, Fixture[]>> = {}): ScheduleFetcher {
  return {
    fetchTodayFixtures: vi.fn(async (sport: string) => by[sport] ?? []),
  } as unknown as ScheduleFetcher;
}

const NOW_ISO = '2026-04-17T18:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

function fixtureAt(minutesFromNow: number, overrides: Partial<Fixture> = {}): Fixture {
  const kickoff = new Date(NOW_MS + minutesFromNow * 60_000).toISOString();
  return {
    eventId: `e-${minutesFromNow}`,
    sport: 'ice_hockey',
    kickoffUtc: kickoff,
    homeTeam: 'Home',
    awayTeam: 'Away',
    ...overrides,
  };
}

describe('LiveWindowManager', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('sets liveWindow:{sport} when a fixture is currently in the window', async () => {
    // Kickoff was 10 minutes ago — inside the 0..3.5h live phase.
    const fx = fixtureAt(-10, { sport: 'ice_hockey' });
    const fetcher = stubFetcher({ ice_hockey: [fx] });

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });

    await mgr.refresh();

    const val = await redis.get(REDIS_KEYS.liveWindow('ice_hockey'));
    expect(val).toBe('1');
    const ttl = await redis.ttl(REDIS_KEYS.liveWindow('ice_hockey'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('deletes liveWindow:{sport} when no fixtures are in the window', async () => {
    await redis.set(REDIS_KEYS.liveWindow('ice_hockey'), '1', 'EX', 600);
    const fetcher = stubFetcher({ ice_hockey: [] });

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });

    await mgr.refresh();

    const val = await redis.get(REDIS_KEYS.liveWindow('ice_hockey'));
    expect(val).toBeNull();
  });

  it('deletes liveWindow:{sport} when fixtures exist but all are outside the window', async () => {
    // Kickoff in 6 hours — well past pre-fetch and live windows.
    const fx = fixtureAt(6 * 60, { sport: 'ice_hockey' });
    const fetcher = stubFetcher({ ice_hockey: [fx] });

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });

    await redis.set(REDIS_KEYS.liveWindow('ice_hockey'), '1', 'EX', 600);
    await mgr.refresh();

    expect(await redis.get(REDIS_KEYS.liveWindow('ice_hockey'))).toBeNull();
  });

  it('publishes pre-fetch notice exactly once per fixture (idempotent)', async () => {
    // Kickoff in 15 minutes — inside pre-fetch window (0–30 min pre-KO).
    const fx = fixtureAt(15, { sport: 'ice_hockey', eventId: 'game-123' });
    const fetcher = stubFetcher({ ice_hockey: [fx] });
    const publishSpy = vi.spyOn(redis, 'publish');

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });

    await mgr.refresh();
    await mgr.refresh();
    await mgr.refresh();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [channel, payload] = publishSpy.mock.calls[0] ?? [];
    expect(channel).toBe('bbs:prefetch:ice_hockey');
    const parsed = JSON.parse(String(payload)) as {
      eventId: string;
      fields: string[];
    };
    expect(parsed.eventId).toBe('game-123');
    expect(parsed.fields).toEqual(['scores', 'lineups', 'odds']);

    // Verify the idempotency marker was set with a sensible TTL.
    expect(await redis.get('prefetch:game-123')).toBe('1');
    const ttl = await redis.ttl('prefetch:game-123');
    expect(ttl).toBeGreaterThan(3000);
  });

  it('does not pre-fetch a fixture whose pre-fetch key already exists', async () => {
    const fx = fixtureAt(15, { sport: 'ice_hockey', eventId: 'game-already-claimed' });
    const fetcher = stubFetcher({ ice_hockey: [fx] });
    await redis.set('prefetch:game-already-claimed', '1', 'EX', 3600);
    const publishSpy = vi.spyOn(redis, 'publish');

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });
    await mgr.refresh();

    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('does not pre-fetch fixtures after kickoff', async () => {
    // Kickoff was 5 minutes ago: inside live window but PAST the pre-fetch gate.
    const fx = fixtureAt(-5, { sport: 'ice_hockey', eventId: 'started' });
    const fetcher = stubFetcher({ ice_hockey: [fx] });
    const publishSpy = vi.spyOn(redis, 'publish');

    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
      sports: ['ice_hockey'],
    });
    await mgr.refresh();

    expect(publishSpy).not.toHaveBeenCalled();
    // ...but the live window is still active
    expect(await redis.get(REDIS_KEYS.liveWindow('ice_hockey'))).toBe('1');
  });

  it('triggerPreFetch returns false on second call for the same fixture', async () => {
    const fetcher = stubFetcher({});
    const mgr = new LiveWindowManager(redis, fetcher, {
      nowFn: () => new Date(NOW_ISO),
    });

    const fx = fixtureAt(15, { sport: 'football', eventId: 'ft-1' });
    const first = await mgr.triggerPreFetch(fx);
    const second = await mgr.triggerPreFetch(fx);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
