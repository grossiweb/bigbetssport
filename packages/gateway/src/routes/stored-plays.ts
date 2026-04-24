import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface StoredPlaysDeps {
  readonly pgPool: Pool;
}

const Query = z.object({
  scoring_only: z.coerce.boolean().optional(),
  period: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

interface DbRow {
  id: string;
  sequence_number: number | null;
  period: number | null;
  period_display: string | null;
  clock: string | null;
  type: string | null;
  description: string | null;
  team_id: string | null;
  player_id: string | null;
  scoring_play: boolean;
  score_value: number | null;
  home_score: number | null;
  away_score: number | null;
  coordinate_x: string | null;
  coordinate_y: string | null;
  wallclock: Date | null;
}

export async function registerStoredPlaysRoutes(
  app: FastifyInstance,
  deps: StoredPlaysDeps,
): Promise<void> {
  /**
   * GET /v1/stored/matches/:id/plays[?scoring_only][&period=1][&limit=500]
   * Returns play-by-play events for a match.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/stored/matches/:id/plays',
    async (req, reply) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply
          .status(400)
          .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid match id', rid));
      }
      const parsed = Query.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query', rid, parsed.error.flatten()));
      }

      const where: string[] = [`match_id = $1::uuid`];
      const params: unknown[] = [id];
      if (parsed.data.scoring_only) where.push(`scoring_play = TRUE`);
      if (parsed.data.period) {
        params.push(parsed.data.period);
        where.push(`period = $${params.length}`);
      }
      params.push(parsed.data.limit);
      const limitIdx = params.length;

      const { rows } = await deps.pgPool.query<DbRow>(
        `SELECT id::text, sequence_number, period, period_display, clock,
                type, description, team_id, player_id, scoring_play, score_value,
                home_score, away_score,
                coordinate_x::text, coordinate_y::text, wallclock
           FROM match_events
          WHERE ${where.join(' AND ')}
          ORDER BY sequence_number ASC NULLS LAST
          LIMIT $${limitIdx}`,
        params,
      );

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          sequence_number: r.sequence_number,
          period: r.period,
          period_display: r.period_display,
          clock: r.clock,
          type: r.type,
          description: r.description,
          team_id: r.team_id,
          player_id: r.player_id,
          scoring_play: r.scoring_play,
          score_value: r.score_value,
          home_score: r.home_score,
          away_score: r.away_score,
          coordinate_x: r.coordinate_x !== null ? Number(r.coordinate_x) : null,
          coordinate_y: r.coordinate_y !== null ? Number(r.coordinate_y) : null,
          wallclock: r.wallclock?.toISOString() ?? null,
        })),
      });
    },
  );
}
