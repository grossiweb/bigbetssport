import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PaginationSchema,
  SportTypeSchema,
  type FetchParams,
  type FieldKey,
  type FieldResult,
} from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface PlayerRouteDeps {
  readonly router: FieldRouter;
}

const PlayerByIdQuery = z.object({ sport: SportTypeSchema });
const PlayerStatsQuery = z.object({
  sport: SportTypeSchema,
  season: z.string().regex(/^\d{4}(-\d{2,4})?$/).optional(),
  league: z.string().min(1).optional(),
  page: PaginationSchema.shape.page.optional(),
  limit: PaginationSchema.shape.limit.optional(),
});

export async function registerPlayersRoutes(
  app: FastifyInstance,
  deps: PlayerRouteDeps,
): Promise<void> {
  app.get<{ Params: { id: string } }>('/v1/players/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = PlayerByIdQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const params: FetchParams = { sport: parsed.data.sport, playerId: req.params.id };
    const outcomes = new Map<FieldKey, FieldResult | null>();
    // Profile card = players field + stats field (career snapshot)
    for (const f of ['players', 'stats'] as const) {
      outcomes.set(f, await deps.router.fetchField(f, params));
    }
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/players/:id/stats', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = PlayerStatsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const { sport, season, league } = parsed.data;
    const params: FetchParams = {
      sport,
      playerId: req.params.id,
      ...(season !== undefined ? { season } : {}),
      ...(league !== undefined ? { leagueId: league } : {}),
    };
    const result = await deps.router.fetchField('stats', params);
    const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
