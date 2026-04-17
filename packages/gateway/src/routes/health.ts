import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { FieldRouter } from '@bbs/orchestrator';

export interface HealthRouteDeps {
  readonly redis: Redis;
  readonly router: FieldRouter;
}

/**
 * GET /health — 200 when Redis is reachable, 503 otherwise.
 */
export async function registerHealthRoute(
  app: FastifyInstance,
  deps: HealthRouteDeps,
): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let redisOk = false;
    try {
      redisOk = (await deps.redis.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }

    const status = redisOk ? 200 : 503;
    return reply.status(status).send({
      service: 'gateway',
      status: redisOk ? 'ok' : 'degraded',
      redis: redisOk,
      adapters: deps.router.getAdapters().size,
    });
  });
}
