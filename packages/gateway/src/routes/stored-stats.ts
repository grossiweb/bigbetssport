import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface StoredStatsDeps {
  readonly pgPool: Pool;
}

interface TeamStatDb {
  team_id: string;
  team_name: string;
  team_logo_url: string | null;
  field: string;
  value: { display?: string | null; label?: string | null };
  source: string;
  fetched_at: Date;
}

interface PlayerStatDb {
  player_id: string;
  player_name: string;
  headshot_url: string | null;
  position: string | null;
  jersey_number: string | null;
  team_id: string | null;
  team_name: string | null;
  field: string;
  value: { value?: string; label?: string | null };
}

export async function registerStoredStatsRoutes(
  app: FastifyInstance,
  deps: StoredStatsDeps,
): Promise<void> {
  /**
   * GET /v1/stored/matches/:id/stats
   * Returns team-level + player-level stats for the match.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/stored/matches/:id/stats',
    async (req, reply) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply
          .status(400)
          .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid match id', rid));
      }

      const teamRes = await deps.pgPool.query<TeamStatDb>(
        `SELECT DISTINCT ON (ms.team_id, ms.field, ms.source)
           ms.team_id,
           t.name AS team_name,
           t.logo_url AS team_logo_url,
           ms.field,
           ms.value,
           ms.source,
           ms.fetched_at
         FROM match_stats ms
         JOIN teams t ON t.bbs_id = ms.team_id
         WHERE ms.match_id = $1
         ORDER BY ms.team_id, ms.field, ms.source, ms.fetched_at DESC`,
        [id],
      );

      const playerRes = await deps.pgPool.query<PlayerStatDb>(
        `SELECT DISTINCT ON (ps.player_id, ps.field)
           ps.player_id,
           p.name AS player_name,
           p.headshot_url,
           p.position,
           p.jersey_number,
           p.team_id,
           t.name AS team_name,
           ps.field,
           ps.value
         FROM player_stats ps
         JOIN players p  ON p.bbs_id = ps.player_id
         LEFT JOIN teams t ON t.bbs_id = p.team_id
         WHERE ps.match_id = $1 AND ps.source = 'espn'
         ORDER BY ps.player_id, ps.field, ps.fetched_at DESC`,
        [id],
      );

      // Pivot player stats into { playerId → { field: value } } per player.
      interface PlayerAgg {
        id: string;
        name: string;
        headshot_url: string | null;
        position: string | null;
        jersey_number: string | null;
        team_id: string | null;
        team_name: string | null;
        stats: Record<string, { value: string; label: string | null }>;
      }
      const byPlayer = new Map<string, PlayerAgg>();
      for (const r of playerRes.rows) {
        let agg = byPlayer.get(r.player_id);
        if (!agg) {
          agg = {
            id: r.player_id,
            name: r.player_name,
            headshot_url: r.headshot_url,
            position: r.position,
            jersey_number: r.jersey_number,
            team_id: r.team_id,
            team_name: r.team_name,
            stats: {},
          };
          byPlayer.set(r.player_id, agg);
        }
        const v = r.value?.value;
        if (v !== undefined) {
          agg.stats[r.field] = { value: String(v), label: r.value?.label ?? null };
        }
      }

      return reply.send({
        data: {
          team_stats: teamRes.rows.map((r) => ({
            team_id: r.team_id,
            team_name: r.team_name,
            team_logo_url: r.team_logo_url,
            field: r.field,
            label: r.value?.label ?? null,
            display_value: r.value?.display ?? null,
            source: r.source,
            fetched_at: r.fetched_at.toISOString(),
          })),
          players: Array.from(byPlayer.values()),
        },
      });
    },
  );
}
