import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface StoredPlayersDeps {
  readonly pgPool: Pool;
}

const Query = z.object({
  sport: z.string().min(1).optional(),
  team: z.string().uuid().optional(),
  league: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface DbRow {
  id: string;
  name: string;
  position: string | null;
  nationality: string | null;
  jersey_number: string | null;
  height: string | null;
  weight: string | null;
  headshot_url: string | null;
  team_id: string | null;
  team_name: string | null;
  team_logo_url: string | null;
  league_name: string | null;
  sport_type: string | null;
}

function mapPlayer(r: DbRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    nationality: r.nationality,
    jersey_number: r.jersey_number,
    height: r.height,
    weight: r.weight,
    headshot_url: r.headshot_url,
    team: r.team_id
      ? {
          id: r.team_id,
          name: r.team_name,
          logo_url: r.team_logo_url,
          league: r.league_name,
          sport: r.sport_type,
        }
      : null,
  };
}

export async function registerStoredPlayersRoutes(
  app: FastifyInstance,
  deps: StoredPlayersDeps,
): Promise<void> {
  /**
   * GET /v1/stored/players[?sport=][&team=<uuid>][&league=][&q=name][&limit=][&offset=]
   */
  app.get('/v1/stored/players', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query', rid, parsed.error.flatten()));
    }
    const { sport, team, league, q, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (sport) {
      params.push(sport);
      where.push(`s.slug = $${params.length}`);
    }
    if (team) {
      params.push(team);
      where.push(`t.bbs_id = $${params.length}::uuid`);
    }
    if (league) {
      params.push(league);
      where.push(`l.name = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`p.name ILIKE $${params.length}`);
    }
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await deps.pgPool.query<DbRow>(
      `SELECT
         p.bbs_id         AS id,
         p.name,
         p.position,
         p.nationality,
         p.jersey_number,
         p.height,
         p.weight,
         p.headshot_url,
         t.bbs_id         AS team_id,
         t.name           AS team_name,
         t.logo_url       AS team_logo_url,
         l.name           AS league_name,
         s.slug           AS sport_type
       FROM players p
       LEFT JOIN teams   t ON t.bbs_id = p.team_id
       LEFT JOIN leagues l ON l.bbs_id = t.league_id
       LEFT JOIN sports  s ON s.bbs_id = l.sport_id
       ${whereSql}
       ORDER BY p.name ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const totalParams = params.slice(0, params.length - 2);
    const totalRes = await deps.pgPool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM players p
         LEFT JOIN teams   t ON t.bbs_id = p.team_id
         LEFT JOIN leagues l ON l.bbs_id = t.league_id
         LEFT JOIN sports  s ON s.bbs_id = l.sport_id
         ${whereSql}`,
      totalParams,
    );

    return reply.send({
      data: rows.map(mapPlayer),
      pagination: {
        total: Number(totalRes.rows[0]?.c ?? 0),
        limit,
        offset,
      },
    });
  });
}
