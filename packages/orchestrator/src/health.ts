import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@bbs/shared';
import type { CBState } from './circuit-breaker.js';
import type { RateLimitOrchestrator } from './orchestrator.js';
import { ALL_SOURCE_IDS, getSource } from './sources/registry.js';

/**
 * Aggregated orchestrator health snapshot. Meant to be exposed by the
 * gateway's `/admin/health` route; also useful for CLI diagnostics.
 *
 *   healthy   — everything closed, quotas have headroom
 *   degraded  — at least one circuit open OR any source ≥ 90% of daily cap
 *   unhealthy — Redis unreachable
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SourceHealth {
  readonly state: CBState;
  readonly quotaRemainingPct: number;
  readonly lastError?: string;
}

export interface QueueHealth {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
}

export interface RedisHealth {
  readonly connected: boolean;
  readonly memoryUsedMb: number;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly sources: Record<string, SourceHealth>;
  readonly redis: RedisHealth;
  readonly queues: Record<string, QueueHealth>;
}

const DEGRADED_QUOTA_PCT = 0.9;

async function checkRedis(redis: Redis): Promise<RedisHealth> {
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') return { connected: false, memoryUsedMb: 0 };
    let memoryUsedMb = 0;
    try {
      const info = await redis.info('memory');
      const m = info.match(/used_memory:(\d+)/);
      if (m && m[1]) memoryUsedMb = Number((Number(m[1]) / 1_048_576).toFixed(2));
    } catch {
      // ioredis-mock doesn't implement INFO; default to 0 and press on.
      memoryUsedMb = 0;
    }
    return { connected: true, memoryUsedMb };
  } catch {
    return { connected: false, memoryUsedMb: 0 };
  }
}

async function checkSource(
  sourceId: string,
  rateLimiter: RateLimitOrchestrator,
): Promise<SourceHealth> {
  const cb = rateLimiter.breakerFor(sourceId);
  const state = await cb.getState();
  const source = getSource(sourceId);
  const dailyCap = source?.dailyCap ?? 0;

  let quotaRemainingPct = 1;
  if (dailyCap > 0) {
    const status = await rateLimiter.quota.getStatus(sourceId);
    const used = status.day.used;
    quotaRemainingPct = Math.max(0, (dailyCap - used) / dailyCap);
  }

  return { state, quotaRemainingPct };
}

async function checkQueue(
  rateLimiter: RateLimitOrchestrator,
  tier: 'P0' | 'P1' | 'P2',
): Promise<QueueHealth> {
  try {
    const queue = rateLimiter.queues.getQueue(tier);
    const counts = await queue.getJobCounts('waiting', 'active', 'failed');
    return {
      waiting: counts['waiting'] ?? 0,
      active: counts['active'] ?? 0,
      failed: counts['failed'] ?? 0,
    };
  } catch {
    // Queue handles can throw under RedisMock (BullMQ uses blocking Redis
    // commands the mock doesn't fully implement). Treat as healthy-zero.
    return { waiting: 0, active: 0, failed: 0 };
  }
}

function rollUpStatus(
  redis: RedisHealth,
  sources: Readonly<Record<string, SourceHealth>>,
): HealthStatus {
  if (!redis.connected) return 'unhealthy';
  for (const s of Object.values(sources)) {
    if (s.state === 'open') return 'degraded';
    if (s.quotaRemainingPct < 1 - DEGRADED_QUOTA_PCT) return 'degraded';
  }
  return 'healthy';
}

export interface HealthCheckOptions {
  readonly redis: Redis;
  readonly rateLimiter: RateLimitOrchestrator;
  readonly sourceIds?: readonly string[];
}

/**
 * Build a `HealthReport` from live Redis + orchestrator state.
 */
export async function checkOrchestratorHealth(
  opts: HealthCheckOptions,
): Promise<HealthReport> {
  const sourceIds = opts.sourceIds ?? ALL_SOURCE_IDS;

  const redisHealth = await checkRedis(opts.redis);

  const sources: Record<string, SourceHealth> = {};
  if (redisHealth.connected) {
    await Promise.all(
      sourceIds.map(async (id) => {
        sources[id] = await checkSource(id, opts.rateLimiter);
      }),
    );
  }

  const queues: Record<string, QueueHealth> = {};
  if (redisHealth.connected) {
    const tiers: Array<'P0' | 'P1' | 'P2'> = ['P0', 'P1', 'P2'];
    await Promise.all(
      tiers.map(async (t) => {
        queues[t] = await checkQueue(opts.rateLimiter, t);
      }),
    );
  }

  return {
    status: rollUpStatus(redisHealth, sources),
    sources,
    redis: redisHealth,
    queues,
  };
}

// Exports used by admin routes / tests.
export { REDIS_KEYS };
