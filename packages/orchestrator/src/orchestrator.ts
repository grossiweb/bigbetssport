import type { Redis } from 'ioredis';
import type { PriorityTier } from '@bbs/shared';
import { QuotaManager, type ConsumeResult } from './quota.js';
import { CircuitBreaker, type CBConfig } from './circuit-breaker.js';
import { PriorityQueueManager } from './priority-queue.js';
import { cbOpensTotal } from './metrics.js';
import { quotaRemaining } from '@bbs/shared';

/**
 * High-level rate-limit orchestrator.
 *
 * Combines `QuotaManager`, `CircuitBreaker`, and `PriorityQueueManager` into
 * one surface used by the field router. The field router asks "can I fire
 * this source?", calls `fired()` when it actually dispatches, and reports
 * the outcome via `succeeded()` or `failed()`.
 */

export type FireDecision =
  | { readonly fire: true }
  | {
      readonly fire: false;
      readonly reason: 'quota' | 'circuit' | 'suspended';
      readonly retryAfterMs?: number;
    };

export interface RateLimitOrchestratorOptions {
  readonly redis: Redis;
  readonly quota?: QuotaManager;
  readonly queues?: PriorityQueueManager;
  readonly breakerConfig?: CBConfig;
}

export class RateLimitOrchestrator {
  readonly quota: QuotaManager;
  readonly queues: PriorityQueueManager;
  private readonly redis: Redis;
  private readonly breakerConfig: CBConfig;
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(opts: RateLimitOrchestratorOptions) {
    this.redis = opts.redis;
    this.quota = opts.quota ?? new QuotaManager(opts.redis);
    this.queues = opts.queues ?? new PriorityQueueManager(opts.redis);
    this.breakerConfig = opts.breakerConfig ?? {};
  }

  /**
   * Get (or lazily create) a CircuitBreaker for this source. We memoise so
   * the `defineCommand` side-effect inside the breaker constructor runs
   * only once per (redis, sourceId) pair.
   */
  breakerFor(sourceId: string): CircuitBreaker {
    let cb = this.breakers.get(sourceId);
    if (!cb) {
      cb = new CircuitBreaker(this.redis, sourceId, this.breakerConfig);
      this.breakers.set(sourceId, cb);
    }
    return cb;
  }

  /**
   * Pre-flight decision for a single source + tier.
   *
   *   1. Is the tier suspended for this source? Return `suspended`.
   *   2. Is the breaker allowing traffic? If not, return `circuit`.
   *   3. Does the quota allow one more call? If not, return `quota`
   *      with the retry-after hint from the rejected bucket.
   *
   * On success, the quota is already atomically decremented — the spec's
   * "optimistic deduct" happens inside `canFire`, not inside `fired`,
   * because otherwise the two steps race under contention.
   */
  async canFire(sourceId: string, tier: PriorityTier): Promise<FireDecision> {
    if (await this.queues.isSuspended(sourceId, tier)) {
      return { fire: false, reason: 'suspended' };
    }
    if (await this.queues.isFailedOver(sourceId)) {
      return { fire: false, reason: 'suspended' };
    }

    const cb = this.breakerFor(sourceId);
    if (!(await cb.allowRequest())) {
      return { fire: false, reason: 'circuit' };
    }

    const consumed: ConsumeResult = await this.quota.consume(sourceId);
    if (!consumed.allowed) {
      return {
        fire: false,
        reason: 'quota',
        retryAfterMs: consumed.retryAfterMs,
      };
    }

    return { fire: true };
  }

  /**
   * Record that a request was actually dispatched. Quota was already
   * deducted in `canFire`; this is a telemetry / bookkeeping hook.
   */
  async fired(_sourceId: string): Promise<void> {
    // intentional no-op — reserved for future hooks (last-fired timestamps,
    // per-request telemetry, etc.) Kept for API symmetry with the spec.
  }

  /**
   * Record a successful upstream response.
   *
   *   - Close the circuit breaker (clear fails counter).
   *   - If the source bills by datapoints (TheRundown), deduct the overage.
   *   - Reapply auto-suspension thresholds based on current daily usage.
   */
  async succeeded(sourceId: string, datapointsUsed?: number): Promise<void> {
    await this.breakerFor(sourceId).recordSuccess();

    if (datapointsUsed !== undefined && datapointsUsed > 1) {
      await this.quota.deductDatapoints(sourceId, datapointsUsed);
    }

    const usedPct = await this.quota.dailyUsedFraction(sourceId);
    await this.queues.applyAutoSuspension(sourceId, usedPct);

    // Update the shared quota_remaining gauge so Prometheus alerts see
    // live data without needing a scheduled refresh job.
    const status = await this.quota.getStatus(sourceId);
    if (status.day.cap > 0) {
      quotaRemaining.set({ source_id: sourceId, bucket: 'day' }, Math.max(0, status.day.cap - status.day.used));
    }
    if (status.minute.cap > 0) {
      quotaRemaining.set(
        { source_id: sourceId, bucket: 'min' },
        Math.max(0, status.minute.cap - status.minute.used),
      );
    }
  }

  /**
   * Record a failed upstream response.
   *
   *   - Increment the breaker's fail counter; may open the circuit.
   *   - If the upstream sent a 429, do NOT count against the breaker
   *     threshold as harshly — it's a rate-limit, not a service failure.
   *     (Hooked up via the adapter reporting `status`.)
   */
  async failed(sourceId: string, status: number): Promise<void> {
    // 429s are informational — the breaker shouldn't open for "you're
    // throttled", since quota tracking already handles that.
    if (status === 429) {
      return;
    }
    const { opened } = await this.breakerFor(sourceId).recordFailure();
    if (opened) {
      cbOpensTotal.inc({ source: sourceId });
    }
  }

  /**
   * Release resources — close BullMQ connections. Redis is owned by the
   * caller and not closed here.
   */
  async close(): Promise<void> {
    await this.queues.close();
  }
}
