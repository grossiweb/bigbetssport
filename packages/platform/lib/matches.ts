import { db } from './db.js';

/**
 * Match queries backing the /dashboard/matches page. Reads rows ingested
 * by `packages/orchestrator/scripts/ingest-rundown.ts`.
 */

export interface MatchRow {
  readonly id: string;
  readonly sportType: string;
  readonly leagueName: string | null;
  readonly home: string;
  readonly away: string;
  readonly homeAbbr: string | null;
  readonly awayAbbr: string | null;
  readonly homeLogoUrl: string | null;
  readonly awayLogoUrl: string | null;
  readonly kickoffUtc: Date;
  readonly status: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly oddsCount: number;
  readonly externalIds: Record<string, string>;
}

export interface LatestOddsRow {
  readonly market: string;
  readonly sportsbook: string;
  readonly participant: string | null;
  readonly value: string | null;
  readonly price: number | null;
  readonly fetchedAt: Date;
}

interface DbMatchRow {
  id: string;
  sport_type: string;
  league_name: string | null;
  home: string;
  away: string;
  home_abbr: string | null;
  away_abbr: string | null;
  home_logo_url: string | null;
  away_logo_url: string | null;
  kickoff_utc: Date;
  status: string;
  home_score: string | null;
  away_score: string | null;
  odds_count: string;
  external_ids: Record<string, string>;
}

export async function listMatches(opts: {
  sport?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<MatchRow[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  // Build dynamic WHERE clause
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.sport) {
    params.push(opts.sport);
    where.push(`m.sport_type = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`m.status = $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await db().query<DbMatchRow>(
    `SELECT
       m.bbs_id          AS id,
       m.sport_type      AS sport_type,
       l.name            AS league_name,
       h.name            AS home,
       a.name            AS away,
       h.short_name      AS home_abbr,
       a.short_name      AS away_abbr,
       h.logo_url        AS home_logo_url,
       a.logo_url        AS away_logo_url,
       m.kickoff_utc     AS kickoff_utc,
       m.status          AS status,
       hs.value->>'score' AS home_score,
       as_.value->>'score' AS away_score,
       (SELECT COUNT(*) FROM odds o WHERE o.match_id = m.bbs_id) AS odds_count,
       m.external_ids
     FROM matches m
     LEFT JOIN leagues l ON l.bbs_id = m.league_id
     LEFT JOIN teams   h ON h.bbs_id = m.home_id
     LEFT JOIN teams   a ON a.bbs_id = m.away_id
     LEFT JOIN LATERAL (
       SELECT value FROM match_stats ms
        WHERE ms.match_id = m.bbs_id AND ms.team_id = m.home_id AND ms.field = 'score'
        ORDER BY ms.fetched_at DESC LIMIT 1
     ) hs ON TRUE
     LEFT JOIN LATERAL (
       SELECT value FROM match_stats ms
        WHERE ms.match_id = m.bbs_id AND ms.team_id = m.away_id AND ms.field = 'score'
        ORDER BY ms.fetched_at DESC LIMIT 1
     ) as_ ON TRUE
     ${whereSql}
     ORDER BY m.kickoff_utc ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return result.rows.map(rowToMatch);
}

export async function countMatches(opts: {
  sport?: string;
  status?: string;
} = {}): Promise<number> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.sport) {
    params.push(opts.sport);
    where.push(`sport_type = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const r = await db().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches ${whereSql}`,
    params,
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function getMatchById(id: string): Promise<MatchRow | null> {
  const rows = await listMatches({ limit: 1 });
  void rows;
  const result = await db().query<DbMatchRow>(
    `SELECT
       m.bbs_id          AS id,
       m.sport_type      AS sport_type,
       l.name            AS league_name,
       h.name            AS home,
       a.name            AS away,
       h.short_name      AS home_abbr,
       a.short_name      AS away_abbr,
       h.logo_url        AS home_logo_url,
       a.logo_url        AS away_logo_url,
       m.kickoff_utc     AS kickoff_utc,
       m.status          AS status,
       hs.value->>'score' AS home_score,
       as_.value->>'score' AS away_score,
       (SELECT COUNT(*) FROM odds o WHERE o.match_id = m.bbs_id) AS odds_count,
       m.external_ids
     FROM matches m
     LEFT JOIN leagues l ON l.bbs_id = m.league_id
     LEFT JOIN teams   h ON h.bbs_id = m.home_id
     LEFT JOIN teams   a ON a.bbs_id = m.away_id
     LEFT JOIN LATERAL (
       SELECT value FROM match_stats ms
        WHERE ms.match_id = m.bbs_id AND ms.team_id = m.home_id AND ms.field = 'score'
        ORDER BY ms.fetched_at DESC LIMIT 1
     ) hs ON TRUE
     LEFT JOIN LATERAL (
       SELECT value FROM match_stats ms
        WHERE ms.match_id = m.bbs_id AND ms.team_id = m.away_id AND ms.field = 'score'
        ORDER BY ms.fetched_at DESC LIMIT 1
     ) as_ ON TRUE
     WHERE m.bbs_id = $1`,
    [id],
  );
  const r = result.rows[0];
  return r ? rowToMatch(r) : null;
}

export async function listLatestOdds(matchId: string): Promise<LatestOddsRow[]> {
  const result = await db().query<{
    market: string;
    sportsbook: string;
    line: { participant?: string; value?: string; price?: number };
    fetched_at: Date;
  }>(
    `SELECT DISTINCT ON (market, sportsbook, line->>'participant')
       market, sportsbook, line, fetched_at
     FROM odds
     WHERE match_id = $1
     ORDER BY market, sportsbook, line->>'participant', fetched_at DESC
     LIMIT 100`,
    [matchId],
  );
  return result.rows.map((r) => ({
    market: r.market,
    sportsbook: r.sportsbook,
    participant: r.line?.participant ?? null,
    value: r.line?.value ?? null,
    price: typeof r.line?.price === 'number' ? r.line.price : null,
    fetchedAt: r.fetched_at,
  }));
}

export async function listAvailableSports(): Promise<
  ReadonlyArray<{ sportType: string; count: number }>
> {
  const r = await db().query<{ sport_type: string; c: string }>(
    `SELECT sport_type, COUNT(*)::text AS c
       FROM matches
      GROUP BY sport_type
      ORDER BY c DESC`,
  );
  return r.rows.map((row) => ({
    sportType: row.sport_type,
    count: Number(row.c),
  }));
}

function rowToMatch(r: DbMatchRow): MatchRow {
  return {
    id: r.id,
    sportType: r.sport_type,
    leagueName: r.league_name,
    home: r.home,
    away: r.away,
    homeAbbr: r.home_abbr,
    awayAbbr: r.away_abbr,
    homeLogoUrl: r.home_logo_url,
    awayLogoUrl: r.away_logo_url,
    kickoffUtc: r.kickoff_utc,
    status: r.status,
    homeScore: r.home_score ? Number(r.home_score) : null,
    awayScore: r.away_score ? Number(r.away_score) : null,
    oddsCount: Number(r.odds_count),
    externalIds: r.external_ids ?? {},
  };
}
