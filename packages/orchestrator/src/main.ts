import { createRedisClient } from '@bbs/shared';
import { RateLimitOrchestrator } from './orchestrator.js';
import { FieldRouter } from './field-router.js';
import { FieldCache } from './cache.js';
import { GapDetector } from './gap-detector.js';
import { buildServer } from './server.js';
import { createAdapterRegistry } from './sources/adapter-registry.js';

const DEFAULT_PORT = 3006;

function resolvePort(): number {
  const raw = process.env['ORCHESTRATOR_PORT'];
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const redis = createRedisClient();

  const orchestrator = new RateLimitOrchestrator({ redis });
  const cache = new FieldCache(redis);
  const adapters = createAdapterRegistry();
  const gapDetector = new GapDetector(redis, []); // MCP scrapers wired in a later P-prompt
  const router = new FieldRouter({ cache, orchestrator, adapters, gapDetector });

  const app = buildServer({ redis, router });
  const port = resolvePort();

  try {
    await app.listen({ host: '0.0.0.0', port });
    app.log.info(`orchestrator listening on :${port}`);
    app.log.info(`adapters registered: ${adapters.size}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] failed to start: ${msg}`);
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await app.close();
      await orchestrator.close();
      await redis.quit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] shutdown error: ${msg}`);
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
  console.error(`[orchestrator] fatal: ${msg}`);
  process.exit(1);
});
