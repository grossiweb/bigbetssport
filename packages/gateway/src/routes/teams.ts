import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PaginationSchema, SportTypeSchema, type FetchParams, type FieldResult } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface TeamRouteDeps {
  readonly router: FieldRouter;
}

const TeamByIdQuery = z.object({
  sport: SportTypeSchema,
  season: z.string().regex(/^\d{4}(-\d{2,4})?$/).optional(),
});

const TeamMatchesQuery = z.object({
  sport: SportTypeSchema,
  season: z.string().regex(/^\d{4}(-\d{2,4})?$/).optional(),
  page: PaginationSchema.shape.page.optional(),
  limit: PaginationSchema.shape.limit.optional(),
});

export async function registerTeamsRoutes(
  app: FastifyInstance,
  deps: TeamRouteDeps,
): Promise<void> {
  app.get<{ Params: { id: string } }>('/v1/teams/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = TeamByIdQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const params: FetchParams = {
      sport: parsed.data.sport,
      teamId: req.params.id,
      ...(parsed.data.season !== undefined ? { season: parsed.data.season } : {}),
    };
    // Team profile + current season stats = stats field with teamId scope.
    const result = await deps.router.fetchField('stats', params);
    const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/teams/:id/matches', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = TeamMatchesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const params: FetchParams = {
      sport: parsed.data.sport,
      teamId: req.params.id,
      ...(parsed.data.season !== undefined ? { season: parsed.data.season } : {}),
    };
    const result = await deps.router.fetchField('historical', params);
    const outcomes = new Map<'historical', FieldResult | null>([['historical', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
