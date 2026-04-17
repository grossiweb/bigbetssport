import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FetchParams, FieldResult } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

/**
 * Cricket-specific REST surface. Each route goes through
 * `FieldRouter.fetchField` with `sport: 'cricket'`, letting the existing
 * field registry + cricketdata adapter pipeline serve the data. The
 * storage-backed flow (P-08 tables + NormalisedStore) isn't queried
 * directly from the gateway yet.
 */

export interface CricketRouteDeps {
  readonly router: FieldRouter;
}

const CRICKET: FetchParams['sport'] = 'cricket';

const MatchListQuery = z.object({
  series: z.string().min(1).optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const SeriesQuery = z.object({
  country: z.string().min(1).optional(),
  format: z.enum(['test', 'odi', 't20', 't20i', 'list_a', 'ipl', 'bbl', 'psl']).optional(),
});

export async function registerCricketRoutes(
  app: FastifyInstance,
  deps: CricketRouteDeps,
): Promise<void> {
  app.get('/v1/cricket/matches', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = MatchListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const { series, date } = parsed.data;
    const params: FetchParams = {
      sport: CRICKET,
      ...(series !== undefined ? { leagueId: series } : {}),
      ...(date !== undefined ? { date } : {}),
    };
    const result = await deps.router.fetchField('scores', params);
    const outcomes = new Map<'scores', FieldResult | null>([['scores', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/cricket/matches/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const params: FetchParams = { sport: CRICKET, matchId: req.params.id };
    const result = await deps.router.fetchField('stats', params);
    const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>(
    '/v1/cricket/matches/:id/scorecard',
    async (req, reply) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const params: FetchParams = { sport: CRICKET, matchId: req.params.id };
      const result = await deps.router.fetchField('stats', params);
      const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
      const { status, body } = buildMultiFieldResponse(outcomes, rid);
      return reply.status(status).send(body);
    },
  );

  app.get('/v1/cricket/series', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = SeriesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    // Standings field serves the "series listing with table" view in
    // cricketdata's API surface.
    const params: FetchParams = { sport: CRICKET };
    const result = await deps.router.fetchField('standings', params);
    const outcomes = new Map<'standings', FieldResult | null>([['standings', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/cricket/players/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const params: FetchParams = { sport: CRICKET, playerId: req.params.id };
    const result = await deps.router.fetchField('players', params);
    const outcomes = new Map<'players', FieldResult | null>([['players', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
