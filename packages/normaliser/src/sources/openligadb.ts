import type { EntityResolver } from '../entity-resolver.js';
import type { MatchStatus, NormalisedMatch, NormalisedPayload } from '../types.js';

/**
 * OpenLigaDB — normaliser for `scores`.
 *
 * Response is a bare array of match objects. Time fields are CET; we use
 * `matchDateTimeUTC` when present. Final results live in the last entry
 * of `matchResults` where `resultTypeID === 2` (endresult).
 */

interface OldbTeam {
  teamId?: number;
  teamName?: string;
  shortName?: string;
}

interface OldbMatchResult {
  resultTypeID?: number;
  pointsTeam1?: number;
  pointsTeam2?: number;
}

interface OldbMatch {
  matchID?: number;
  matchDateTimeUTC?: string;
  matchDateTime?: string;
  leagueName?: string;
  leagueId?: number;
  team1?: OldbTeam;
  team2?: OldbTeam;
  matchResults?: OldbMatchResult[];
  matchIsFinished?: boolean;
}

function pickEndResult(results: OldbMatchResult[] | undefined): OldbMatchResult | undefined {
  if (!Array.isArray(results)) return undefined;
  return results.find((r) => r.resultTypeID === 2) ?? results[results.length - 1];
}

function statusOf(m: OldbMatch, kickoff: string): MatchStatus {
  if (m.matchIsFinished) return 'finished';
  const now = Date.now();
  const ts = Date.parse(kickoff);
  if (Number.isFinite(ts)) {
    if (now < ts) return 'scheduled';
    return 'live';
  }
  return 'scheduled';
}

export async function normaliseOpenLigaDbScores(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (!Array.isArray(raw)) return null;

  const matches: NormalisedMatch[] = [];
  for (const m of raw as OldbMatch[]) {
    if (!m || typeof m !== 'object') continue;
    const kickoff = m.matchDateTimeUTC ?? m.matchDateTime;
    if (typeof kickoff !== 'string') continue;
    const homeName = m.team1?.teamName;
    const awayName = m.team2?.teamName;
    const leagueName = m.leagueName;
    if (!homeName || !awayName || !leagueName) continue;

    const [home, away, league] = await Promise.all([
      resolver.resolveTeam(homeName, 'football', source),
      resolver.resolveTeam(awayName, 'football', source),
      resolver.resolveLeague(leagueName, 'football'),
    ]);
    if (home.confidence < 0.5 || away.confidence < 0.5 || league.confidence < 0.5) continue;

    const end = pickEndResult(m.matchResults);

    matches.push({
      home_bbs_id: home.bbs_id,
      away_bbs_id: away.bbs_id,
      league_bbs_id: league.bbs_id,
      kickoff_utc: kickoff,
      status: statusOf(m, kickoff),
      ...(end?.pointsTeam1 !== undefined ? { score_home: end.pointsTeam1 } : {}),
      ...(end?.pointsTeam2 !== undefined ? { score_away: end.pointsTeam2 } : {}),
      source,
      confidence: Math.min(home.confidence, away.confidence, league.confidence),
    });
  }

  return { kind: 'matches', data: matches };
}
