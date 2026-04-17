import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@bbs/shared';
import type { RateLimitOrchestrator } from './orchestrator.js';
import {
  THERUNDOWN_BASE,
  THERUNDOWN_AUTH_HEADER,
  THERUNDOWN_ENV_KEY,
  buildTheRundownDeltaRequest,
} from './sources/tier2/therundown.js';

/**
 * TheRundown delta polling loop.
 *
 * TheRundown exposes a `/markets/delta?last_id={cursor}` endpoint that
 * returns only markets that have changed since the given cursor. We
 * bootstrap with a full snapshot to get a starting cursor, then poll.
 *
 *   - Live window active (liveWindow:{sportId} exists) → 5s interval
 *   - Otherwise → 60s interval
 *
 * Stale-cursor detection: if the delta call returns zero changes while a
 * live window is active, or the upstream returns HTTP 400 (TheRundown's
 * way of saying "your cursor is too old"), we re-bootstrap.
 *
 * This class is intended to be driven by a BullMQ repeatable job whose
 * processor calls `run(sportId)`.
 */

const POLL_INTERVAL_ACTIVE_MS = 5_000;
const POLL_INTERVAL_IDLE_MS = 60_000;

export interface DeltaResult {
  readonly changes: readonly unknown[];
  readonly newCursor: string;
  readonly staleCursorDetected: boolean;
}

function bootstrapUrl(sportId: number, date: string): string {
  const u = new URL(`${THERUNDOWN_BASE}/sports/${sportId}/events/${encodeURIComponent(date)}`);
  u.searchParams.set('include', 'scores,all_periods');
  return u.toString();
}

export class DeltaPoller {
  constructor(
    private readonly redis: Redis,
    private readonly orchestrator: RateLimitOrchestrator,
  ) {}

  /**
   * Fetch a full snapshot and seed the cursor. Returns the fresh cursor.
   */
  async bootstrap(sportId: number, date: string): Promise<string> {
    const apiKey = process.env[THERUNDOWN_ENV_KEY];
    const headers = new Headers({ accept: 'application/json' });
    if (apiKey) headers.set(THERUNDOWN_AUTH_HEADER, apiKey);

    const response = await fetch(bootstrapUrl(sportId, date), { headers });
    if (!response.ok) {
      throw new Error(`bootstrap failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { meta?: { delta_last_id?: string } };
    const cursor = data.meta?.delta_last_id ?? '';
    await this.redis.set(REDIS_KEYS.deltaCursor(String(sportId)), cursor);
    return cursor;
  }

  /**
   * Single poll tick. Reads the stored cursor, calls the delta endpoint,
   * advances the cursor, and returns changes + staleness signal.
   */
  async pollDelta(sportId: number): Promise<DeltaResult> {
    const cursorKey = REDIS_KEYS.deltaCursor(String(sportId));
    const cursor = await this.redis.get(cursorKey);
    const apiKey = process.env[THERUNDOWN_ENV_KEY];
    const req = buildTheRundownDeltaRequest(sportId, cursor, apiKey);

    const response = await fetch(req);

    if (response.status === 400) {
      return { changes: [], newCursor: cursor ?? '', staleCursorDetected: true };
    }
    if (!response.ok) {
      throw new Error(`delta poll failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      events?: readonly unknown[];
      meta?: { delta_last_id?: string };
    };
    const changes = data.events ?? [];
    const newCursor = data.meta?.delta_last_id ?? cursor ?? '';

    if (newCursor && newCursor !== cursor) {
      await this.redis.set(cursorKey, newCursor);
    }

    const liveActive =
      (await this.redis.exists(REDIS_KEYS.liveWindow(String(sportId)))) === 1;
    const staleCursorDetected = changes.length === 0 && liveActive;

    return { changes, newCursor, staleCursorDetected };
  }

  /**
   * Full poll tick for one sport — invoked by the BullMQ repeatable job.
   *
   *   - If no cursor stored, bootstrap first (using today's date).
   *   - If delta returns staleCursorDetected, re-bootstrap immediately.
   *
   * Does not loop internally; the repeatable-job scheduler drives cadence
   * (`POLL_INTERVAL_ACTIVE_MS` vs `POLL_INTERVAL_IDLE_MS` is consulted
   * separately by the scheduler).
   */
  async run(sportId: number): Promise<void> {
    try {
      const cursorKey = REDIS_KEYS.deltaCursor(String(sportId));
      const existingCursor = await this.redis.get(cursorKey);
      const today = new Date().toISOString().slice(0, 10);

      if (!existingCursor) {
        await this.bootstrap(sportId, today);
        return;
      }

      const result = await this.pollDelta(sportId);
      if (result.staleCursorDetected) {
        await this.bootstrap(sportId, today);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[delta-poller:${sportId}] ${msg}`);
      await this.orchestrator.failed('therundown', 0).catch(() => {
        /* best-effort */
      });
    }
  }

  /**
   * Returns the appropriate poll interval for this sport right now, based
   * on whether a live window is active.
   */
  async pollIntervalMs(sportId: number): Promise<number> {
    const active =
      (await this.redis.exists(REDIS_KEYS.liveWindow(String(sportId)))) === 1;
    return active ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
  }
}
