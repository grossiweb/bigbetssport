import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { checkOrchestratorHealth } from './health.js';
import { RateLimitOrchestrator } from './orchestrator.js';
import { REDIS_KEYS } from '@bbs/shared';

describe('checkOrchestratorHealth', () => {
  let redis: Redis;
  let rateLimiter: RateLimitOrchestrator;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    rateLimiter = new RateLimitOrchestrator({ redis });
  });

  afterEach(async () => {
    await rateLimiter.close();
    await redis.quit();
  });

  it('reports "healthy" with all circuits closed and no quota usage', async () => {
    const report = await checkOrchestratorHealth({
      redis,
      rateLimiter,
      sourceIds: ['nhl-api', 'api-sports'],
    });
    expect(report.status).toBe('healthy');
    expect(report.redis.connected).toBe(true);
    expect(report.sources['nhl-api']?.state).toBe('closed');
  });

  it('returns "degraded" when any circuit is open', async () => {
    // Manually trip the api-sports breaker by forcing its state key.
    await redis.set(REDIS_KEYS.cb('api-sports'), 'open');
    await redis.set(`${REDIS_KEYS.cb('api-sports')}:cooldown`, '1', 'PX', 60_000);

    const report = await checkOrchestratorHealth({
      redis,
      rateLimiter,
      sourceIds: ['nhl-api', 'api-sports'],
    });
    expect(report.status).toBe('degraded');
    expect(report.sources['api-sports']?.state).toBe('open');
    expect(report.sources['nhl-api']?.state).toBe('closed');
  });

  it('returns "unhealthy" when Redis ping fails', async () => {
    // Simulate a broken Redis — replace `ping` with a thrower.
    const broken = {
      ping: async () => {
        throw new Error('connection refused');
      },
    } as unknown as Redis;

    const report = await checkOrchestratorHealth({
      redis: broken,
      rateLimiter,
      sourceIds: ['nhl-api'],
    });
    expect(report.status).toBe('unhealthy');
    expect(report.redis.connected).toBe(false);
  });
});
