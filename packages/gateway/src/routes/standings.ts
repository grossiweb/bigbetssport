import type { FastifyInstance } from 'fastify';
import { StandingsQuerySchema, type FetchParams, type FieldResult } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

export interface StandingsRouteDeps {
  readonly router: FieldRouter;
}

export async function registerStandingsRoutes(
  app: FastifyInstance,
  deps: StandingsRouteDeps,
): Promise<void> {
  app.get('/v1/standings', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = StandingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid, parsed.error.flatten()));
    }
    const { sport, leagueId, season } = parsed.data;
    const params: FetchParams = {
      sport,
      leagueId,
      ...(season !== undefined ? { season } : {}),
    };
    const result = await deps.router.fetchField('standings', params);
    const outcomes = new Map<'standings', FieldResult | null>([['standings', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
