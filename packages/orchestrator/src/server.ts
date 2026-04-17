import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { registry } from './metrics.js';
import type { FieldRouter } from './field-router.js';
import { SOURCES } from './sources/registry.js';

export interface ServerDeps {
  readonly redis: Redis;
  readonly router: FieldRouter;
}

/**
 * Build a Fastify server exposing `/health`, `/metrics`, and `/sources`.
 * Caller owns lifecycle (`listen`, `close`).
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    disableRequestLogging: false,
  });

  app.get('/health', async (_req, reply) => {
    let redisOk = false;
    try {
      const pong = await deps.redis.ping();
      redisOk = pong === 'PONG';
    } catch {
      redisOk = false;
    }

    const status = redisOk ? 200 : 503;
    return reply.status(status).send({
      service: 'orchestrator',
      status: redisOk ? 'ok' : 'degraded',
      redis: redisOk,
      sources: Object.keys(SOURCES).length,
      adapters: deps.router.getAdapters().size,
    });
  });

  app.get('/metrics', async (_req, reply) => {
    const body = await registry.metrics();
    return reply.type(registry.contentType).send(body);
  });

  app.get('/sources', async () => {
    return Object.values(SOURCES).map((s) => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      sports: s.sports,
      dailyCap: s.dailyCap,
      perMinuteCap: s.perMinuteCap,
      hasAdapter: deps.router.getAdapters().has(s.id),
    }));
  });

  return app;
}
