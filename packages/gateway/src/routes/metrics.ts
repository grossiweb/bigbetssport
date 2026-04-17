import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Registry } from 'prom-client';
import { bbsRegistry } from '@bbs/shared';
import { registry as gatewayRegistry } from '../metrics.js';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';

/**
 * GET /metrics — Prometheus exposition.
 *
 * Merges the gateway's local registry with the shared `bbsRegistry` from
 * `@bbs/shared/metrics` so a single scrape target sees everything.
 *
 * Gated by an IP allowlist from the `METRICS_ALLOWED_IPS` env var
 * (comma-separated). Default is `127.0.0.1,::1`. Matches are substring to
 * keep IPv4-mapped IPv6 (`::ffff:127.0.0.1`) working without extra logic.
 */

function allowedIps(): readonly string[] {
  const raw = process.env['METRICS_ALLOWED_IPS'];
  if (!raw || raw.trim().length === 0) return ['127.0.0.1', '::1'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isAllowed(req: FastifyRequest): boolean {
  const allowed = allowedIps();
  const remote = req.ip ?? req.socket?.remoteAddress ?? '';
  if (!remote) return false;
  for (const entry of allowed) {
    if (entry === '*') return true;
    if (remote === entry) return true;
    if (remote.includes(entry)) return true;
  }
  return false;
}

export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (req, reply) => {
    if (!isAllowed(req)) {
      const rid = (req as AuthedRequest).requestId ?? req.id;
      return reply
        .status(403)
        .send(errorEnvelope(ERROR_CODES.FORBIDDEN, 'metrics endpoint is IP-restricted', rid));
    }
    const merged = Registry.merge([gatewayRegistry, bbsRegistry]);
    const body = await merged.metrics();
    return reply.type(merged.contentType).send(body);
  });
}
