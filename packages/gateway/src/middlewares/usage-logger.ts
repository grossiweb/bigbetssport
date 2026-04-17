import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AuthedRequest } from '../auth.js';

/**
 * Usage logger — after every response, insert a row into `usage_events`
 * so the platform dashboard can chart per-key usage.
 *
 * Runs after `onResponse`, completely async — never blocks the HTTP reply.
 * Soft-fails on DB issues (logs, continues): we'd rather lose a metric
 * row than break a customer's integration.
 *
 * Enable by registering with a live `pg.Pool`. Tests pass in a pg-mem pool.
 */

export interface UsageLoggerOptions {
  readonly pool: Pool;
}

interface UsageRow {
  readonly keyId: string;
  readonly endpoint: string;
  readonly sport: string | null;
  readonly field: string | null;
  readonly via: 'api' | 'cache' | 'mcp';
  readonly statusCode: number;
  readonly latencyMs: number;
}

function extractSport(req: { query?: unknown; params?: unknown }): string | null {
  const qs = req.query as Record<string, unknown> | undefined;
  if (qs && typeof qs['sport'] === 'string') return qs['sport'] as string;
  return null;
}

function extractField(req: { query?: unknown }): string | null {
  const qs = req.query as Record<string, unknown> | undefined;
  if (qs && typeof qs['fields'] === 'string') {
    const first = (qs['fields'] as string).split(',')[0]?.trim();
    return first && first.length > 0 ? first : null;
  }
  return null;
}

async function usageLoggerPlugin(
  app: FastifyInstance,
  opts: UsageLoggerOptions,
): Promise<void> {
  app.addHook('onResponse', async (req, reply) => {
    const authed = req as AuthedRequest;
    const keyId = authed.auth?.keyId;
    if (!keyId) return;

    const route = req.routeOptions?.url ?? req.url.split('?')[0] ?? req.url;
    // Only log /v1/* routes; skip /health, /metrics, /admin/*, /platform/*.
    if (!route.startsWith('/v1/')) return;

    const latencyMs = Math.round(reply.elapsedTime);

    const row: UsageRow = {
      keyId,
      endpoint: route,
      sport: extractSport(req),
      field: extractField(req),
      via: 'api',
      statusCode: reply.statusCode,
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
    };

    // Fire-and-forget; swallow errors so a DB hiccup can't 500 the request.
    void opts.pool
      .query(
        `INSERT INTO usage_events
           (key_id, endpoint, sport, field, via, status_code, latency_ms, datapoints)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [row.keyId, row.endpoint, row.sport, row.field, row.via, row.statusCode, row.latencyMs],
      )
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err: msg }, 'usage-logger: insert failed');
      });
  });
}

export default fp(usageLoggerPlugin, { name: 'bbs-usage-logger' });
