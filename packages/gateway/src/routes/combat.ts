import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FetchParams, FieldResult, SportType } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildMultiFieldResponse, errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

/**
 * Combat-sport REST surface (MMA + boxing). Each route accepts a `sport`
 * query param to disambiguate MMA vs boxing; `athletes/*` routes serve
 * both sports under one namespace.
 *
 * `/v1/fight-cards` sorts the returned bouts by `bout_order ASC` so the
 * main event lands last when scraper payloads echo the UFCStats card
 * ordering.
 */

export interface CombatRouteDeps {
  readonly router: FieldRouter;
}

const CombatSportSchema = z.enum(['mma', 'boxing']);

const FightCardListQuery = z.object({
  sport: CombatSportSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const SingleCardQuery = z.object({ sport: CombatSportSchema });
const BoutQuery = z.object({ sport: CombatSportSchema });
const AthleteQuery = z.object({ sport: CombatSportSchema });

/** Coerce the extracted payload to an array sorted by `bout_order ASC`. */
function sortByBoutOrder(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const copy = [...value];
  copy.sort((a, b) => {
    const ao = pickBoutOrder(a);
    const bo = pickBoutOrder(b);
    if (ao === bo) return 0;
    if (ao === null) return 1;
    if (bo === null) return -1;
    return ao - bo;
  });
  return copy;
}

function pickBoutOrder(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as { bout_order?: unknown; boutOrder?: unknown };
  const v = o.bout_order ?? o.boutOrder;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function withSortedBouts(result: FieldResult | null): FieldResult | null {
  if (!result) return null;
  return { ...result, value: sortByBoutOrder(result.value) };
}

export async function registerCombatRoutes(
  app: FastifyInstance,
  deps: CombatRouteDeps,
): Promise<void> {
  app.get('/v1/fight-cards', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = FightCardListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, 'invalid query parameters', rid));
    }
    const sport = parsed.data.sport as SportType;
    const params: FetchParams = {
      sport,
      ...(parsed.data.date !== undefined ? { date: parsed.data.date } : {}),
    };
    const result = withSortedBouts(await deps.router.fetchField('scores', params));
    const outcomes = new Map<'scores', FieldResult | null>([['scores', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/fight-cards/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = SingleCardQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
    }
    const sport = parsed.data.sport as SportType;
    const params: FetchParams = { sport, matchId: req.params.id };
    const result = withSortedBouts(await deps.router.fetchField('scores', params));
    const outcomes = new Map<'scores', FieldResult | null>([['scores', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/bouts/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = BoutQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
    }
    const sport = parsed.data.sport as SportType;
    const params: FetchParams = { sport, matchId: req.params.id };
    const result = await deps.router.fetchField('stats', params);
    const outcomes = new Map<'stats', FieldResult | null>([['stats', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/athletes/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = AthleteQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
    }
    const sport = parsed.data.sport as SportType;
    const params: FetchParams = { sport, playerId: req.params.id };
    const result = await deps.router.fetchField('players', params);
    const outcomes = new Map<'players', FieldResult | null>([['players', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/athletes/:id/record', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const parsed = AthleteQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorEnvelope(ERROR_CODES.BAD_REQUEST, '`sport` query param is required', rid));
    }
    const sport = parsed.data.sport as SportType;
    const params: FetchParams = { sport, playerId: req.params.id };
    const result = await deps.router.fetchField('historical', params);
    const outcomes = new Map<'historical', FieldResult | null>([['historical', result]]);
    const { status, body } = buildMultiFieldResponse(outcomes, rid);
    return reply.status(status).send(body);
  });
}
