import type { FieldKey, SportType } from '@bbs/shared';

/**
 * Maps a (sport, field, live?) tuple to the recommended poll interval in
 * milliseconds.
 *
 * Tiers (from the P-05 spec):
 *
 *   Live window active       → scores 5s, odds 10s, else 15s
 *   Pre-match (not live)     → scores/odds 30s, lineups 60s
 *   Idle (slow fields, off)  → 120s
 *
 * `sport` is accepted for future per-sport overrides but isn't consulted
 * by the current policy. We don't want to invent premature specialisation
 * — field + live state captures everything the spec specifies.
 */

export const POLL_INTERVALS = {
  LIVE_SCORES_MS: 5_000,
  LIVE_ODDS_MS: 10_000,
  LIVE_OTHER_MS: 15_000,
  PREMATCH_FAST_MS: 30_000,
  PREMATCH_LINEUPS_MS: 60_000,
  IDLE_MS: 120_000,
} as const;

export function getPollIntervalMs(
  _sport: SportType,
  field: FieldKey,
  isLive: boolean,
): number {
  if (isLive) {
    if (field === 'scores') return POLL_INTERVALS.LIVE_SCORES_MS;
    if (field === 'odds') return POLL_INTERVALS.LIVE_ODDS_MS;
    return POLL_INTERVALS.LIVE_OTHER_MS;
  }
  if (field === 'scores' || field === 'odds') return POLL_INTERVALS.PREMATCH_FAST_MS;
  if (field === 'lineups') return POLL_INTERVALS.PREMATCH_LINEUPS_MS;
  return POLL_INTERVALS.IDLE_MS;
}
