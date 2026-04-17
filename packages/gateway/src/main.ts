import { createRedisClient, createRedisPubSub } from '@bbs/shared';
import {
  FieldCache,
  FieldRouter,
  GapDetector,
  RateLimitOrchestrator,
  createAdapterRegistry,
} from '@bbs/orchestrator';
import { buildServer } from './server.js';
import { attachWebSocket } from './websocket.js';

const DEFAULT_PORT = 3000;

function resolvePort(): number {
  // Railway/Fly inject PORT; local dev uses GATEWAY_PORT; fall back to 3000.
  const raw = process.env['PORT'] ?? process.env['GATEWAY_PORT'];
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const redis = createRedisClient();
  const { sub: subscriber } = createRedisPubSub();

  const orchestrator = new RateLimitOrchestrator({ redis });
  const cache = new FieldCache(redis);
  const adapters = createAdapterRegistry();
  const gapDetector = new GapDetector(redis, []);
  const router = new FieldRouter({ cache, orchestrator, adapters, gapDetector });

  const app = await buildServer({
    redis,
    router,
    rateLimiter: orchestrator,
    disableAuth: process.env['BBS_DISABLE_AUTH'] === '1',
  });

  const port = resolvePort();
  try {
    await app.listen({ host: '0.0.0.0', port });
    app.log.info(`gateway listening on :${port}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gateway] failed to start: ${msg}`);
    process.exit(1);
  }

  // socket.io bound to Fastify's underlying HTTP server.
  const io = attachWebSocket({
    httpServer: app.server,
    subscriber,
    disableAuth: process.env['BBS_DISABLE_AUTH'] === '1',
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      io.close();
      await app.close();
      await orchestrator.close();
      await subscriber.quit();
      await redis.quit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gateway] shutdown error: ${msg}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[gateway] fatal: ${msg}`);
  process.exit(1);
});
