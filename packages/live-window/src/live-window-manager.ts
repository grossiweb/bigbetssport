import type { Redis } from 'ioredis';
import { ALL_SPORTS, REDIS_KEYS, type SportType } from '@bbs/shared';
import type { Fixture } from './types.js';
import type { ScheduleFetcher } from './schedule-fetcher.js';

/**
 * LiveWindowManager — maintains two Redis keys per sport / event:
 *
 *   liveWindow:{sportId}   — '1' with 600s TTL while any match for that
 *                            sport is inside its live window.
 *   prefetch:{eventId}     — '1' with 3600s TTL once we've published a
 *                            pre-fetch notice for a specific fixture.
 *                            SET NX guarantees we only fire once per fixture.
 *
 * Window boundaries:
 *   opens  = kickoff − 30 min
 *   closes = kickoff + 3.5 h
 *
 * The pre-fetch pub/sub payload is a JSON blob on
 * `bbs:prefetch:{sport}`; an orchestrator subscriber enqueues P0 ingest
 * jobs for scores/lineups/odds.
 *
 * This class is driven by a BullMQ repeatable job that calls `refresh()`
 * on a 5-minute cadence. It is pure-ish — no background timers of its own.
 */

export const LIVE_WINDOW_OPEN_BEFORE_MS = 30 * 60 * 1_000;
export const LIVE_WINDOW_CLOSE_AFTER_MS = 3.5 * 60 * 60 * 1_000;
export const LIVE_WINDOW_TTL_SECONDS = 600;
export const PREFETCH_TTL_SECONDS = 3_600;

const PREFETCH_FIELDS = ['scores', 'lineups', 'odds'] as const;

function prefetchKey(eventId: string): string {
  return `prefetch:${eventId}`;
}

function prefetchChannel(sport: SportType): string {
  return `bbs:prefetch:${sport}`;
}

export interface PrefetchMessage {
  readonly eventId: string;
  readonly sport: SportType;
  readonly kickoffUtc: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly fields: readonly string[];
}

export interface LiveWindowManagerOptions {
  readonly nowFn?: () => Date;
  /** Override the list of sports to iterate. Defaults to `ALL_SPORTS`. */
  readonly sports?: readonly SportType[];
}

export class LiveWindowManager {
  private readonly nowFn: () => Date;
  private readonly sports: readonly SportType[];

  constructor(
    private readonly redis: Redis,
    private readonly fetcher: ScheduleFetcher,
    options: LiveWindowManagerOptions = {},
  ) {
    this.nowFn = options.nowFn ?? (() => new Date());
    this.sports = options.sports ?? ALL_SPORTS;
  }

  /**
   * Single refresh tick. Called every 5 minutes by a BullMQ repeatable job.
   */
  async refresh(): Promise<void> {
    const nowMs = this.nowFn().getTime();

    for (const sport of this.sports) {
      const fixtures = await this.fetcher.fetchTodayFixtures(sport);
      const liveKey = REDIS_KEYS.liveWindow(sport);

      let anyInWindow = false;

      for (const fixture of fixtures) {
        const kickoffMs = Date.parse(fixture.kickoffUtc);
        if (!Number.isFinite(kickoffMs)) continue;

        const openMs = kickoffMs - LIVE_WINDOW_OPEN_BEFORE_MS;
        const closeMs = kickoffMs + LIVE_WINDOW_CLOSE_AFTER_MS;

        if (nowMs >= openMs && nowMs <= closeMs) {
          anyInWindow = true;
        }

        // Pre-fetch once per fixture when inside the 30-min pre-window.
        if (nowMs >= openMs && nowMs < kickoffMs) {
          await this.tryPreFetch(fixture);
        }
      }

      if (anyInWindow) {
        await this.redis.set(liveKey, '1', 'EX', LIVE_WINDOW_TTL_SECONDS);
      } else {
        await this.redis.del(liveKey);
      }
    }
  }

  /**
   * Public pre-fetch entry point. Idempotent — callers may invoke freely;
   * the Redis `SET NX` guard ensures we publish at most once per fixture
   * within the `PREFETCH_TTL_SECONDS` window.
   */
  async triggerPreFetch(fixture: Fixture): Promise<boolean> {
    return this.tryPreFetch(fixture);
  }

  private async tryPreFetch(fixture: Fixture): Promise<boolean> {
    const key = prefetchKey(fixture.eventId);
    // SET NX EX: atomic "claim this fixture's pre-fetch slot".
    const claimed = await this.redis.set(key, '1', 'EX', PREFETCH_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') return false;

    const message: PrefetchMessage = {
      eventId: fixture.eventId,
      sport: fixture.sport,
      kickoffUtc: fixture.kickoffUtc,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      fields: PREFETCH_FIELDS,
    };

    try {
      await this.redis.publish(prefetchChannel(fixture.sport), JSON.stringify(message));
    } catch (err) {
      // Don't unwind the claim — the event has logically fired. Log and move on.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live-window:prefetch:${fixture.sport}] publish failed: ${msg}`);
    }
    return true;
  }
}
