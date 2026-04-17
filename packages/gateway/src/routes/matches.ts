import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FieldSelectionSchema,
  MatchQuerySchema,
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

export interface MatchRouteDeps {
  readonly router: FieldRouter;
}

const MatchListQuery = z.object({
  league: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']).optional(),
  sport: SportTypeSchema.optional(),
  page: PaginationSchema.shape.page.optional(),
  limit: PaginationSchema.shape.limit.optional(),
});

const MatchByIdQuery = z.object({
  sport: SportTypeSchema,
  fields: FieldSelectionSchema.optional(),
});

const DEFAULT_MATCH_FIELDS: readonly FieldKey[] = ['scores'];

export async function registerMatchesRoutes(
  app: FastifyInstance,
  deps: MatchRouteDeps,
): Promise<void> {
  /**
   * GET /v1/matches — list/filter matches (thin wrapper over /v1/matches/:id
   * fields='scores' for the date/sport combo). The heavy lifting is inside
   * `FieldRouter.fetchField('scores', ...)` which returns all matches for
   * the query window.
   */
  app.get('/v1/matches', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = MatchListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid, parsed.error.flatten()));
    }
    const { league, date, sport } = parsed.data;
    if (!sport) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` is required', rid));
    }
    const params: FetchParams = {
      sport,
      ...(league !== undefined ? { leagueId: league } : {}),
      ...(date !== undefined ? { date } : {}),
    };
    const result = await deps.router.fetchField('scores', params);
    const outcomes = new Map<'scores', FieldResult | null>([['scores', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  /**
   * GET /v1/matches/:id?sport=football&fields=scores,odds,lineups,stats,xg
   */
  app.get<{ Params: { id: string } }>('/v1/matches/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = MatchByIdQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid, parsed.error.flatten()));
    }
    const { sport, fields } = parsed.data;
    const params: FetchParams = { sport, matchId: req.params.id };
    const requested = fields && fields.length > 0 ? fields : DEFAULT_MATCH_FIELDS;

    const outcomes = new Map<FieldKey, FieldResult | null>();
    for (const f of requested) {
      outcomes.set(f, await deps.router.fetchField(f, params));
    }
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  /**
   * GET /v1/matches/:id/odds — proxy to the odds field with the match id.
   * Paginated by sportsbook + market; storage layer (P-05/P-08) can push
   * true history rows later. For now we return the latest snapshot.
   */
  app.get<{ Params: { id: string }; Querystring: { sport?: string } }>(
    '/v1/matches/:id/odds',
    async (req, reply) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const sport = SportTypeSchema.safeParse(req.query.sport);
      if (!sport.success) {
        return reply
          .status(400)
          .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
      }
      const result = await deps.router.fetchField('odds', {
        sport: sport.data,
        matchId: req.params.id,
      });
      const outcomes = new Map<'odds', FieldResult | null>([['odds', result]]);
      const { status, body } = buildMultiFieldResponse(outcomes, rid);
      return reply.status(status).send(body);
    },
  );

  /**
   * GET /v1/matches/:id/events — play-by-play / match events.
   * Served via the `stats` field for now (same upstream path); a future
   * revision can split into a dedicated field in FIELD_REGISTRY.
   */
  app.get<{ Params: { id: string }; Querystring: { sport?: string } }>(
    '/v1/matches/:id/events',
    async (req, reply) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const sport = SportTypeSchema.safeParse(req.query.sport);
      if (!sport.success) {
        return reply
          .status(400)
          .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
      }
      const result = await deps.router.fetchField('stats', {
        sport: sport.data,
        matchId: req.params.id,
      });
      const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
      const { status, body } = buildMultiFieldResponse(outcomes, rid);
      return reply.status(status).send(body);
    },
  );

  // `MatchQuerySchema` from shared stays exported — we use its primitives
  // (SportTypeSchema etc.) directly instead of re-validating the whole blob.
  void MatchQuerySchema;
}
