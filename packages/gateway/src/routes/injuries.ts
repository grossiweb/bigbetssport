import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PaginationSchema,
  SportTypeSchema,
  type FetchParams,
  type FieldResult,
} from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface InjuriesRouteDeps {
  readonly router: FieldRouter;
}

const InjuriesQuery = z.object({
  sport: SportTypeSchema,
  team: z.string().min(1).optional(),
  page: PaginationSchema.shape.page.optional(),
  limit: PaginationSchema.shape.limit.optional(),
});

export async function registerInjuriesRoutes(
  app: FastifyInstance,
  deps: InjuriesRouteDeps,
): Promise<void> {
  app.get('/v1/injuries', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = InjuriesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const { sport, team } = parsed.data;
    const params: FetchParams = {
      sport,
      ...(team !== undefined ? { teamId: team } : {}),
    };
    const result = await deps.router.fetchField('injuries', params);
    const outcomes = new Map<'injuries', FieldResult | null>([['injuries', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
