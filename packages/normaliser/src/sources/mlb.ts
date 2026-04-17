import type { EntityResolver } from '../entity-resolver.js';
import type { MatchStatus, NormalisedMatch, NormalisedPayload } from '../types.js';

/**
 * MLB StatsAPI — normaliser for `scores`.
 *
 * Expected shape:
 *   { dates: [ { games: [ { gamePk, gameDate,
 *                           status: { abstractGameState, detailedState },
 *                           teams: { home: { team: { name }, score },
 *                                    away: { team: { name }, score } } } ] } ] }
 */

function mapStatus(abstract: unknown, detailed: unknown): MatchStatus {
  if (typeof detailed === 'string') {
    const d = detailed.toLowerCase();
    if (d.includes('postpon')) return 'postponed';
    if (d.includes('cancel')) return 'cancelled';
  }
  if (typeof abstract === 'string') {
    const a = abstract.toLowerCase();
    if (a === 'live') return 'live';
    if (a === 'final') return 'finished';
  }
  return 'scheduled';
}

interface MlbTeamSide {
  team?: { name?: string };
  score?: number;
}

function teamNameAndScore(side: unknown): { name: string | null; score?: number } {
  if (side === null || typeof side !== 'object') return { name: null };
  const s = side as MlbTeamSide;
  const name = s.team?.name ?? null;
  const score = typeof s.score === 'number' ? s.score : undefined;
  return { name, score };
}

export async function normaliseMlbScores(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const dates = (raw as { dates?: unknown[] }).dates;
  if (!Array.isArray(dates)) return null;

  const matches: NormalisedMatch[] = [];
  for (const dateEntry of dates) {
    if (dateEntry === null || typeof dateEntry !== 'object') continue;
    const games = (dateEntry as { games?: unknown[] }).games;
    if (!Array.isArray(games)) continue;

    for (const game of games) {
      if (game === null || typeof game !== 'object') continue;
      const g = game as {
        gameDate?: string;
        status?: { abstractGameState?: string; detailedState?: string };
        teams?: { home?: unknown; away?: unknown };
      };
      if (typeof g.gameDate !== 'string') continue;

      const home = teamNameAndScore(g.teams?.home);
      const away = teamNameAndScore(g.teams?.away);
      if (!home.name || !away.name) continue;

      const [homeRes, awayRes, leagueRes] = await Promise.all([
        resolver.resolveTeam(home.name, 'baseball', source),
        resolver.resolveTeam(away.name, 'baseball', source),
        resolver.resolveLeague('MLB', 'baseball'),
      ]);
      if (homeRes.confidence < 0.5 || awayRes.confidence < 0.5 || leagueRes.confidence < 0.5) {
        continue;
      }

      matches.push({
        home_bbs_id: homeRes.bbs_id,
        away_bbs_id: awayRes.bbs_id,
        league_bbs_id: leagueRes.bbs_id,
        kickoff_utc: g.gameDate,
        status: mapStatus(g.status?.abstractGameState, g.status?.detailedState),
        ...(home.score !== undefined ? { score_home: home.score } : {}),
        ...(away.score !== undefined ? { score_away: away.score } : {}),
        source,
        confidence: Math.min(homeRes.confidence, awayRes.confidence, leagueRes.confidence),
      });
    }
  }

  return { kind: 'matches', data: matches };
}
