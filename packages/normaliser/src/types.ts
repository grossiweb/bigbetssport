/**
 * Canonical shapes produced by the normaliser. These are the Postgres-ready
 * forms — downstream storage (P-05) maps them onto the `matches`, `odds`,
 * `match_stats`, `player_stats`, and `players` tables.
 */

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export interface NormalisedMatch {
  /** Populated when the match already exists in our catalogue. */
  bbs_id?: string;
  home_bbs_id: string;
  away_bbs_id: string;
  league_bbs_id: string;
  kickoff_utc: string;
  status: MatchStatus;
  score_home?: number;
  score_away?: number;
  source: string;
  /** Composite confidence: worst of (home, away, league) entity resolution. */
  confidence: number;
}

export interface NormalisedOdds {
  bbs_id?: string;
  match_bbs_id: string;
  market: string;
  sportsbook: string;
  line: unknown;
  fetchedAt: string;
  source: string;
  confidence: number;
}

export interface NormalisedPlayer {
  bbs_id?: string;
  team_bbs_id?: string;
  name: string;
  position?: string;
  source: string;
  confidence: number;
}

export interface NormalisedStats {
  match_bbs_id: string;
  team_bbs_id?: string;
  player_bbs_id?: string;
  field: string;
  value: unknown;
  source: string;
  confidence: number;
  fetchedAt: string;
}

/**
 * Tagged union: the dispatcher returns exactly one of these, or null when
 * it has no normaliser for the (source, field) combination.
 */
export type NormalisedPayload =
  | { readonly kind: 'matches'; readonly data: readonly NormalisedMatch[] }
  | { readonly kind: 'odds'; readonly data: readonly NormalisedOdds[] }
  | { readonly kind: 'players'; readonly data: readonly NormalisedPlayer[] }
  | { readonly kind: 'stats'; readonly data: readonly NormalisedStats[] };
