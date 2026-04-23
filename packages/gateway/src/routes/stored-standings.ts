import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface StoredStandingsDeps {
  readonly pgPool: Pool;
}

const Query = z.object({
  sport: z.string().min(1).optional(),
  league: z.string().min(1).optional(),
});

interface DbRow {
  league_id: string;
  league_name: string;
  sport_type: string;
  season: string;
  team_id: string;
  team_name: string;
  logo_url: string | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  win_pct: string | null;
  games_played: number | null;
  points_for: string | null;
  points_against: string | null;
  streak: string | null;
  updated_at: Date;
}

export async function registerStoredStandingsRoutes(
  app: FastifyInstance,
  deps: StoredStandingsDeps,
): Promise<void> {
  /**
   * GET /v1/stored/standings[?sport=basketball][&league=NBA]
   * Returns grouped standings arrays keyed by league.
   */
  app.get('/v1/stored/standings', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query', rid, parsed.error.flatten()));
    }
    const where: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.sport) {
      params.push(parsed.data.sport);
      where.push(`s.slug = $${params.length}`);
    }
    if (parsed.data.league) {
      params.push(parsed.data.league);
      where.push(`l.name = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await deps.pgPool.query<DbRow>(
      `SELECT
         l.bbs_id          AS league_id,
         l.name            AS league_name,
         s.slug            AS sport_type,
         st.season         AS season,
         t.bbs_id          AS team_id,
         t.name            AS team_name,
         t.logo_url        AS logo_url,
         st.rank, st.wins, st.losses, st.ties,
         st.win_pct::text AS win_pct,
         st.games_played,
         st.points_for::text AS points_for,
         st.points_against::text AS points_against,
         st.streak, st.updated_at
       FROM standings st
       JOIN leagues l ON l.bbs_id = st.league_id
       JOIN sports  s ON s.bbs_id = l.sport_id
       JOIN teams   t ON t.bbs_id = st.team_id
       ${whereSql}
       ORDER BY l.name, st.rank ASC NULLS LAST, st.wins DESC NULLS LAST`,
      params,
    );

    interface Group {
      league_id: string;
      league_name: string;
      sport: string;
      season: string;
      rows: Array<Record<string, unknown>>;
    }
    const byLeague = new Map<string, Group>();
    for (const r of rows) {
      let g = byLeague.get(r.league_id);
      if (!g) {
        g = {
          league_id: r.league_id,
          league_name: r.league_name,
          sport: r.sport_type,
          season: r.season,
          rows: [],
        };
        byLeague.set(r.league_id, g);
      }
      g.rows.push({
        team_id: r.team_id,
        team_name: r.team_name,
        logo_url: r.logo_url,
        rank: r.rank,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        win_pct: r.win_pct !== null ? Number(r.win_pct) : null,
        games_played: r.games_played,
        points_for: r.points_for !== null ? Number(r.points_for) : null,
        points_against: r.points_against !== null ? Number(r.points_against) : null,
        streak: r.streak,
        updated_at: r.updated_at.toISOString(),
      });
    }
    return reply.send({ data: Array.from(byLeague.values()) });
  });
}
