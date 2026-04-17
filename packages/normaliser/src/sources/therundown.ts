import type { FieldKey, SportType } from '@bbs/shared';
import type { EntityResolver } from '../entity-resolver.js';
import type {
  MatchStatus,
  NormalisedMatch,
  NormalisedOdds,
  NormalisedPayload,
} from '../types.js';

/**
 * TheRundown normalisers (scores + odds).
 *
 * Spec note: use `teams_normalized`, not `teams` — the former is already
 * cleaned up by TheRundown and avoids duplicate-name pitfalls.
 */

const TR_SPORT_MAP: Readonly<Record<number, SportType>> = {
  2: 'american_football',
  3: 'baseball',
  4: 'basketball',
  6: 'ice_hockey',
  7: 'mma',
  9: 'boxing',
  10: 'football',
  11: 'football',
  12: 'football',
  13: 'football',
  14: 'football',
  15: 'football',
  16: 'football',
  17: 'football',
  18: 'football',
  19: 'football',
};

interface TrNormalisedTeam {
  name?: string;
  mascot?: string;
  team_id?: number;
  is_home?: boolean;
}

interface TrEvent {
  event_id?: string;
  sport_id?: number;
  event_date?: string;
  event_status?: string;
  league_name?: string;
  score?: { event_status?: string; score_home?: number; score_away?: number };
  teams_normalized?: TrNormalisedTeam[];
  lines?: Record<string, TrLine>;
}

interface TrLine {
  line_id?: number | string;
  affiliate?: { affiliate_name?: string };
  moneyline?: { moneyline_home?: number; moneyline_away?: number; moneyline_draw?: number };
  spread?: { point_spread_home?: number; point_spread_away?: number };
  total?: { total_over?: number; total_under?: number };
  total_over?: number;
  total_under?: number;
  date_updated?: string;
}

function buildTeamName(t: TrNormalisedTeam | undefined): string | null {
  if (!t) return null;
  const parts = [t.name, t.mascot].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return parts.length > 0 ? parts.join(' ').trim() : null;
}

function statusOf(code: unknown): MatchStatus {
  if (typeof code !== 'string') return 'scheduled';
  const s = code.toUpperCase();
  if (s === 'STATUS_IN_PROGRESS' || s.includes('IN_PROGRESS')) return 'live';
  if (s === 'STATUS_FINAL' || s.includes('FINAL')) return 'finished';
  if (s.includes('POSTPONED')) return 'postponed';
  if (s.includes('CANCEL')) return 'cancelled';
  return 'scheduled';
}

async function normaliseScoresEvents(
  events: TrEvent[],
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedMatch[]> {
  const matches: NormalisedMatch[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (typeof event.event_date !== 'string') continue;

    const sport = event.sport_id !== undefined ? TR_SPORT_MAP[event.sport_id] : undefined;
    if (!sport) continue;

    const teams = event.teams_normalized ?? [];
    if (teams.length !== 2) continue;
    const homeTeam = teams.find((t) => t.is_home) ?? teams[0];
    const awayTeam = teams.find((t) => t.is_home === false) ?? teams[1];
    const homeName = buildTeamName(homeTeam);
    const awayName = buildTeamName(awayTeam);
    if (!homeName || !awayName) continue;

    const leagueName = event.league_name ?? '';
    const [home, away, league] = await Promise.all([
      resolver.resolveTeam(homeName, sport, source),
      resolver.resolveTeam(awayName, sport, source),
      leagueName
        ? resolver.resolveLeague(leagueName, sport)
        : Promise.resolve({ bbs_id: '', confidence: 0, method: 'unresolved' as const }),
    ]);
    if (home.confidence < 0.5 || away.confidence < 0.5 || league.confidence < 0.5) continue;

    matches.push({
      home_bbs_id: home.bbs_id,
      away_bbs_id: away.bbs_id,
      league_bbs_id: league.bbs_id,
      kickoff_utc: event.event_date,
      status: statusOf(event.score?.event_status ?? event.event_status),
      ...(event.score?.score_home !== undefined ? { score_home: event.score.score_home } : {}),
      ...(event.score?.score_away !== undefined ? { score_away: event.score.score_away } : {}),
      source,
      confidence: Math.min(home.confidence, away.confidence, league.confidence),
    });
  }
  return matches;
}

export async function normaliseTheRundownScores(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const events = (raw as { events?: unknown[] }).events;
  if (!Array.isArray(events)) return null;
  const matches = await normaliseScoresEvents(events as TrEvent[], resolver, source);
  return { kind: 'matches', data: matches };
}

/**
 * TheRundown `odds` — one NormalisedOdds per (event, sportsbook, market).
 * Falls out of each event's `lines` map.
 */
export async function normaliseTheRundownOdds(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const events = (raw as { events?: unknown[] }).events;
  if (!Array.isArray(events)) return null;

  const out: NormalisedOdds[] = [];

  for (const ev of events as TrEvent[]) {
    if (!ev || typeof ev !== 'object') continue;
    const sport = ev.sport_id !== undefined ? TR_SPORT_MAP[ev.sport_id] : undefined;
    if (!sport) continue;

    // We need the canonical match bbs_id — resolve teams so we can tag odds
    // against the right match row once the storage layer looks it up.
    const teams = ev.teams_normalized ?? [];
    const homeTeam = teams.find((t) => t.is_home) ?? teams[0];
    const awayTeam = teams.find((t) => t.is_home === false) ?? teams[1];
    const homeName = buildTeamName(homeTeam);
    const awayName = buildTeamName(awayTeam);
    if (!homeName || !awayName) continue;

    const [homeRes, awayRes] = await Promise.all([
      resolver.resolveTeam(homeName, sport, source),
      resolver.resolveTeam(awayName, sport, source),
    ]);
    if (homeRes.confidence < 0.5 || awayRes.confidence < 0.5) continue;

    const lines = ev.lines ?? {};
    const fetchedAt = new Date().toISOString();
    for (const line of Object.values(lines)) {
      if (!line || typeof line !== 'object') continue;
      const sportsbook = line.affiliate?.affiliate_name ?? 'unknown';

      if (line.moneyline) {
        out.push({
          match_bbs_id: `${homeRes.bbs_id}:${awayRes.bbs_id}`,
          market: 'moneyline',
          sportsbook,
          line: line.moneyline,
          fetchedAt,
          source,
          confidence: Math.min(homeRes.confidence, awayRes.confidence),
        });
      }
      if (line.spread) {
        out.push({
          match_bbs_id: `${homeRes.bbs_id}:${awayRes.bbs_id}`,
          market: 'spread',
          sportsbook,
          line: line.spread,
          fetchedAt,
          source,
          confidence: Math.min(homeRes.confidence, awayRes.confidence),
        });
      }
      if (line.total) {
        out.push({
          match_bbs_id: `${homeRes.bbs_id}:${awayRes.bbs_id}`,
          market: 'total',
          sportsbook,
          line: line.total,
          fetchedAt,
          source,
          confidence: Math.min(homeRes.confidence, awayRes.confidence),
        });
      }
    }
  }

  return { kind: 'odds', data: out };
}

// Signature kept compatible with the dispatch table.
export async function normaliseTheRundownField(
  field: FieldKey,
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  switch (field) {
    case 'scores':
      return normaliseTheRundownScores(raw, resolver, source);
    case 'odds':
      return normaliseTheRundownOdds(raw, resolver, source);
    default:
      return null;
  }
}
