import type { EntityResolver } from '../entity-resolver.js';
import type { MatchStatus, NormalisedMatch, NormalisedPayload } from '../types.js';

/**
 * NHL Stats API — normaliser for the `scores` field.
 *
 * Expected shape (abbreviated):
 *   { games: [ { id, startTimeUTC, gameState,
 *                homeTeam: { id, name: { default }, score },
 *                awayTeam: { id, name: { default }, score } } ] }
 */

const NHL_STATUS_MAP: Readonly<Record<string, MatchStatus>> = {
  FUT: 'scheduled',
  PRE: 'scheduled',
  LIVE: 'live',
  CRIT: 'live',
  FINAL: 'finished',
  OFF: 'finished',
  PPD: 'postponed',
  CANCELED: 'cancelled',
  CNCL: 'cancelled',
};

function statusOf(code: unknown): MatchStatus {
  if (typeof code !== 'string') return 'scheduled';
  return NHL_STATUS_MAP[code] ?? 'scheduled';
}

function nameOf(team: unknown): string | null {
  if (team === null || typeof team !== 'object') return null;
  const name = (team as { name?: { default?: string } }).name;
  if (name && typeof name.default === 'string') return name.default;
  return null;
}

function scoreOf(team: unknown): number | undefined {
  if (team === null || typeof team !== 'object') return undefined;
  const s = (team as { score?: number }).score;
  return typeof s === 'number' ? s : undefined;
}

export async function normaliseNhlScores(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const games = (raw as { games?: unknown[] }).games;
  if (!Array.isArray(games)) return null;

  const matches: NormalisedMatch[] = [];
  for (const game of games) {
    if (game === null || typeof game !== 'object') continue;
    const g = game as {
      startTimeUTC?: string;
      gameState?: string;
      homeTeam?: unknown;
      awayTeam?: unknown;
    };

    const homeName = nameOf(g.homeTeam);
    const awayName = nameOf(g.awayTeam);
    if (!homeName || !awayName) continue;
    if (typeof g.startTimeUTC !== 'string') continue;

    const [home, away, league] = await Promise.all([
      resolver.resolveTeam(homeName, 'ice_hockey', source),
      resolver.resolveTeam(awayName, 'ice_hockey', source),
      resolver.resolveLeague('NHL', 'ice_hockey'),
    ]);
    if (home.confidence < 0.5 || away.confidence < 0.5 || league.confidence < 0.5) continue;

    const status = statusOf(g.gameState);
    const scoreHome = scoreOf(g.homeTeam);
    const scoreAway = scoreOf(g.awayTeam);

    matches.push({
      home_bbs_id: home.bbs_id,
      away_bbs_id: away.bbs_id,
      league_bbs_id: league.bbs_id,
      kickoff_utc: g.startTimeUTC,
      status,
      ...(scoreHome !== undefined ? { score_home: scoreHome } : {}),
      ...(scoreAway !== undefined ? { score_away: scoreAway } : {}),
      source,
      confidence: Math.min(home.confidence, away.confidence, league.confidence),
    });
  }

  return { kind: 'matches', data: matches };
}
