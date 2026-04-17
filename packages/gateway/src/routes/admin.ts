import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import {
  ALL_SOURCE_IDS,
  SOURCES,
  checkOrchestratorHealth,
  getSource,
  type RateLimitOrchestrator,
} from '@bbs/orchestrator';
import { MCP_SCRAPERS } from '@bbs/mcp-fleet';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

/**
 * Admin routes. Protected by an `x-admin-key` header that must match the
 * `ADMIN_KEY` env var. These routes are added to the consumer auth plugin's
 * `publicPaths` so the normal API-key flow doesn't interfere; our own
 * preHandler handles admin auth.
 *
 * Intentionally small: no write-side orchestration beyond reset-circuit
 * and reset-quota. Anything richer (re-ingest, backfill) belongs in a
 * separate tool.
 */

export interface AdminRouteDeps {
  readonly redis: Redis;
  readonly rateLimiter: RateLimitOrchestrator;
}

const GAP_EVENTS_LIST = 'gap:events:recent';

function envelope<T>(data: T, requestId: string) {
  return {
    data,
    meta: {
      source: 'admin',
      confidence: 1,
      cached: false,
      cache_age_ms: 0,
      request_id: requestId,
    },
    error: null,
  };
}

function checkAdminKey(
  req: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
): boolean {
  const configured = process.env['ADMIN_KEY'];
  if (!configured) {
    // If the server was started without ADMIN_KEY the admin surface is
    // locked shut — easier to miss a config than to enable-and-leave-open.
    void reply
      .status(503)
      .send(errorEnvelope(ERROR_CODES.INTERNAL, 'ADMIN_KEY is not configured', requestId));
    return false;
  }
  const header = req.headers['x-admin-key'];
  const raw = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : '';
  if (!raw || raw !== configured) {
    void reply
      .status(401)
      .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'invalid admin key', requestId));
    return false;
  }
  return true;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: AdminRouteDeps,
): Promise<void> {
  // All admin routes run through this guard.
  app.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions.url ?? req.url;
    if (!url.startsWith('/admin')) return;
    const rid = (req as AuthedRequest).requestId ?? 'unknown';
    if (!checkAdminKey(req, reply, rid)) {
      // reply already sent by checkAdminKey
      return reply;
    }
    return;
  });

  app.get('/admin/health', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const report = await checkOrchestratorHealth({
      redis: deps.redis,
      rateLimiter: deps.rateLimiter,
    });
    return envelope(report, rid);
  });

  app.get('/admin/quota', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const rows = await Promise.all(
      ALL_SOURCE_IDS.map(async (id) => {
        const status = await deps.rateLimiter.quota.getStatus(id);
        return {
          sourceId: id,
          day: status.day,
          minute: status.minute,
        };
      }),
    );
    return envelope(rows, rid);
  });

  app.get('/admin/sources', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const out = await Promise.all(
      Object.values(SOURCES).map(async (s) => {
        const state = await deps.rateLimiter.breakerFor(s.id).getState();
        return {
          id: s.id,
          name: s.name,
          tier: s.tier,
          sports: s.sports,
          circuitState: state,
          dailyCap: s.dailyCap,
          perMinuteCap: s.perMinuteCap,
        };
      }),
    );
    return envelope(out, rid);
  });

  app.get('/admin/gaps', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const raw = await deps.redis.lrange(GAP_EVENTS_LIST, 0, 99);
    const entries = raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((v): v is unknown => v !== null);
    return envelope(entries, rid);
  });

  app.post<{ Params: { id: string } }>('/admin/sources/:id/reset', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    if (!getSource(req.params.id)) {
      return reply
        .status(404)
        .send(errorEnvelope(ERROR_CODES.NOT_FOUND, `unknown source: ${req.params.id}`, rid));
    }
    await deps.rateLimiter.breakerFor(req.params.id).reset();
    return envelope({ sourceId: req.params.id, reset: true }, rid);
  });

  app.post<{ Params: { id: string } }>('/admin/quota/:id/reset', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    if (!getSource(req.params.id)) {
      return reply
        .status(404)
        .send(errorEnvelope(ERROR_CODES.NOT_FOUND, `unknown source: ${req.params.id}`, rid));
    }
    await deps.rateLimiter.quota.resetDaily(req.params.id);
    return envelope({ sourceId: req.params.id, resetDaily: true }, rid);
  });

  app.get('/admin/mcp', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const out = MCP_SCRAPERS.map((scraper) => ({
      id: scraper.id,
      name: scraper.name,
      tool: scraper.tool,
      coveredFields: scraper.coveredFields,
      coveredSports: scraper.coveredSports,
      rateLimit: scraper.rateLimit,
      mcpServerUrl: scraper.mcpServerUrl,
    }));
    return envelope(out, rid);
  });
}
