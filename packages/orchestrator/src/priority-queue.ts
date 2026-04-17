import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import type { FetchParams, FieldKey, PriorityTier } from '@bbs/shared';

/**
 * Priority-queue layer.
 *
 * Wraps the three ingest-tier BullMQ queues (P0/P1/P2) and adds per-source
 * tier suspension — driven by quota usage via `applyAutoSuspension`.
 */

export const PRIORITY_QUEUE_NAMES = {
  P0: 'ingest-p0',
  P1: 'ingest-p1',
  P2: 'ingest-p2',
} as const;

export type IngestQueueName = (typeof PRIORITY_QUEUE_NAMES)[PriorityTier];

export interface IngestJob<T = unknown> {
  readonly sourceId: string;
  readonly field: FieldKey;
  readonly params: FetchParams;
  readonly payload?: T;
  readonly enqueuedAt: string;
}

export interface AutoSuspensionThresholds {
  readonly p2Start: number;
  readonly p1Start: number;
  readonly p0Start: number;
}

export const DEFAULT_THRESHOLDS: AutoSuspensionThresholds = {
  p2Start: 0.9,
  p1Start: 0.95,
  p0Start: 1.0,
};

export type SuspensionReason = 'quota' | 'manual';

function suspensionKey(sourceId: string, tier: PriorityTier): string {
  return `suspended:${sourceId}:${tier}`;
}

function failoverKey(sourceId: string): string {
  return `failover:${sourceId}`;
}

/**
 * Map a `FieldKey` to its default priority tier.
 *
 *   P0 — real-time hot data (live scores).
 *   P1 — near-real-time (odds, lineups, injuries, xg).
 *   P2 — slow-moving (players, stats, historical, transfers, standings).
 */
export function tierForField(field: FieldKey): PriorityTier {
  switch (field) {
    case 'scores':
      return 'P0';
    case 'odds':
    case 'lineups':
    case 'injuries':
    case 'xg':
      return 'P1';
    case 'players':
    case 'stats':
    case 'historical':
    case 'transfers':
    case 'standings':
      return 'P2';
    default: {
      const _exhaustive: never = field;
      void _exhaustive;
      return 'P2';
    }
  }
}

export class PriorityQueueManager {
  private readonly queues: Record<PriorityTier, Queue>;
  private readonly thresholds: AutoSuspensionThresholds;

  constructor(
    private readonly redis: Redis,
    thresholds: AutoSuspensionThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.queues = {
      P0: new Queue(PRIORITY_QUEUE_NAMES.P0, { connection: redis }),
      P1: new Queue(PRIORITY_QUEUE_NAMES.P1, { connection: redis }),
      P2: new Queue(PRIORITY_QUEUE_NAMES.P2, { connection: redis }),
    };
    this.thresholds = thresholds;

    for (const q of Object.values(this.queues)) {
      q.on('error', (err: Error) => {
        console.error(`[priority-queue:${q.name}] ${err.message}`);
      });
    }
  }

  /**
   * Raw queue access — workers register their processors against these.
   */
  getQueue(tier: PriorityTier): Queue {
    return this.queues[tier];
  }

  getQueues(): Readonly<Record<PriorityTier, Queue>> {
    return this.queues;
  }

  async enqueue<T>(job: IngestJob<T>, tier: PriorityTier): Promise<string> {
    if (await this.isSuspended(job.sourceId, tier)) {
      throw new Error(
        `cannot enqueue: ${job.sourceId} is suspended at tier ${tier}`,
      );
    }
    const queue = this.queues[tier];
    const added = await queue.add(`ingest:${job.field}`, job);
    return added.id ?? 'unknown';
  }

  /**
   * Suspend `tier` for `sourceId`. If a suspension already exists we
   * extend its TTL (refreshing the window).
   */
  async suspend(
    sourceId: string,
    tier: PriorityTier,
    reason: SuspensionReason = 'quota',
    ttlMs = 15 * 60_000,
  ): Promise<void> {
    await this.redis.set(suspensionKey(sourceId, tier), reason, 'PX', ttlMs);
  }

  async resume(sourceId: string, tier: PriorityTier): Promise<void> {
    await this.redis.del(suspensionKey(sourceId, tier));
  }

  async isSuspended(sourceId: string, tier: PriorityTier): Promise<boolean> {
    const v = await this.redis.exists(suspensionKey(sourceId, tier));
    return v === 1;
  }

  /**
   * Mark a source for failover — field router should skip it entirely.
   */
  async markFailover(sourceId: string, ttlMs = 15 * 60_000): Promise<void> {
    await this.redis.set(failoverKey(sourceId), '1', 'PX', ttlMs);
  }

  async isFailedOver(sourceId: string): Promise<boolean> {
    const v = await this.redis.exists(failoverKey(sourceId));
    return v === 1;
  }

  /**
   * Quota-driven tier suspension.
   *
   *   usedPct  ≥ 1.00 → suspend P0/P1/P2 + markFailover
   *   usedPct  ≥ 0.95 → suspend P1/P2
   *   usedPct  ≥ 0.90 → suspend P2
   *   usedPct  <  0.90 → resume all three tiers
   *
   * The "trigger failover" clause on 100% is implemented by setting the
   * `failover:{sourceId}` key, which the field router checks as part of
   * its "should I fire this source?" decision.
   */
  async applyAutoSuspension(sourceId: string, usedPct: number): Promise<void> {
    if (usedPct >= this.thresholds.p0Start) {
      await this.suspend(sourceId, 'P0');
      await this.suspend(sourceId, 'P1');
      await this.suspend(sourceId, 'P2');
      await this.markFailover(sourceId);
      return;
    }
    if (usedPct >= this.thresholds.p1Start) {
      await this.suspend(sourceId, 'P1');
      await this.suspend(sourceId, 'P2');
      await this.resume(sourceId, 'P0');
      return;
    }
    if (usedPct >= this.thresholds.p2Start) {
      await this.suspend(sourceId, 'P2');
      await this.resume(sourceId, 'P1');
      await this.resume(sourceId, 'P0');
      return;
    }
    await Promise.all([
      this.resume(sourceId, 'P0'),
      this.resume(sourceId, 'P1'),
      this.resume(sourceId, 'P2'),
    ]);
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}
