import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

/**
 * DB-backed match routes. Read directly from the `matches`/`teams`/`odds`
 * tables populated by `packages/orchestrator/scripts/ingest-rundown.ts`.
 *
 * Exposes a stable read API that does not depend on live upstream calls —
 * every hit is a Postgres SELECT and scales independently of source quotas.
 *
 *   GET /v1/matches        list (sport, status, date filters)
 *   GET /v1/matches/:id    single match + latest odds
 */

export interface StoredMatchesDeps {
  readonly pgPool: Pool;
}

const ListQuery = z.object({
  sport: z.string().min(1).optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'cancelled']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface MatchRowDb {
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
  linescore: { home: number[]; away: number[] } | null;
  attendance: number | null;
  broadcast: string | null;
}

interface OddsRowDb {
  market: string;
  sportsbook: string;
  line: { participant?: string; value?: string; price?: number };
  fetched_at: Date;
}

const MATCH_SELECT = `
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
  m.external_ids,
  m.linescore,
  m.attendance,
  m.broadcast`;

const MATCH_JOINS = `
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
  ) as_ ON TRUE`;

function mapMatch(r: MatchRowDb): Record<string, unknown> {
  return {
    id: r.id,
    sport: r.sport_type,
    league: r.league_name,
    home: { name: r.home, short_name: r.home_abbr, logo_url: r.home_logo_url },
    away: { name: r.away, short_name: r.away_abbr, logo_url: r.away_logo_url },
    kickoff_utc: r.kickoff_utc.toISOString(),
    status: r.status,
    score:
      r.home_score !== null && r.away_score !== null
        ? { home: Number(r.home_score), away: Number(r.away_score) }
        : null,
    linescore: r.linescore ?? null,
    attendance: r.attendance,
    broadcast: r.broadcast,
    odds_count: Number(r.odds_count),
    external_ids: r.external_ids ?? {},
  };
}

export async function registerStoredMatchesRoutes(
  app: FastifyInstance,
  deps: StoredMatchesDeps,
): Promise<void> {
  /**
   * GET /v1/matches — stored matches list.
   * Overrides the FieldRouter-backed handler registered earlier because
   * Fastify uses last-write-wins for route conflicts… actually it throws;
   * so we mount at /v1/stored/matches instead.
   */
  app.get('/v1/stored/matches', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query', rid, parsed.error.flatten()));
    }
    const { sport, status, date, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (sport) {
      params.push(sport);
      where.push(`m.sport_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`m.status = $${params.length}`);
    }
    if (date) {
      params.push(date);
      where.push(`m.kickoff_utc::date = $${params.length}::date`);
    }
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await deps.pgPool.query<MatchRowDb>(
      `SELECT ${MATCH_SELECT}
         ${MATCH_JOINS}
         ${whereSql}
         ORDER BY m.kickoff_utc ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const totalParams = params.slice(0, params.length - 2);
    const totalRes = await deps.pgPool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM matches m ${whereSql}`,
      totalParams,
    );

    return reply.send({
      data: rows.map(mapMatch),
      pagination: {
        total: Number(totalRes.rows[0]?.c ?? 0),
        limit,
        offset,
      },
    });
  });

  /**
   * GET /v1/stored/matches/:id — single match with latest odds per
   * (market, sportsbook, participant).
   */
  app.get<{ Params: { id: string } }>('/v1/stored/matches/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid match id', rid));
    }
    const { rows } = await deps.pgPool.query<MatchRowDb>(
      `SELECT ${MATCH_SELECT} ${MATCH_JOINS} WHERE m.bbs_id = $1`,
      [id],
    );
    const match = rows[0];
    if (!match) {
      return reply
        .status(404)
        .send(errorEnvelope(ERROR_CODES.NOT_FOUND, 'match not found', rid));
    }
    const oddsRes = await deps.pgPool.query<OddsRowDb>(
      `SELECT DISTINCT ON (market, sportsbook, line->>'participant')
         market, sportsbook, line, fetched_at
       FROM odds
       WHERE match_id = $1
       ORDER BY market, sportsbook, line->>'participant', fetched_at DESC
       LIMIT 200`,
      [id],
    );
    return reply.send({
      data: {
        ...mapMatch(match),
        odds: oddsRes.rows.map((r) => ({
          market: r.market,
          sportsbook: r.sportsbook,
          participant: r.line?.participant ?? null,
          value: r.line?.value ?? null,
          price: typeof r.line?.price === 'number' ? r.line.price : null,
          fetched_at: r.fetched_at.toISOString(),
        })),
      },
    });
  });

  /**
   * GET /v1/stored/sports — available sports (count of matches per sport).
   */
  app.get('/v1/stored/sports', async (_req, reply) => {
    const { rows } = await deps.pgPool.query<{ sport_type: string; c: string }>(
      `SELECT sport_type, COUNT(*)::text AS c
         FROM matches
         GROUP BY sport_type
         ORDER BY c DESC`,
    );
    return reply.send({
      data: rows.map((r) => ({ sport: r.sport_type, match_count: Number(r.c) })),
    });
  });
}
