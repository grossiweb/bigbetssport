import { createRedisClient } from '@bbs/shared';
import type { McpScraperServer } from './server-base.js';
import {
  McpBoxrecServer,
  McpCricbuzzServer,
  McpCricinfoServer,
  McpEspnFullServer,
  McpFbrefServer,
  McpRotowireServer,
  McpSofaScoreServer,
  McpTapologyServer,
  McpTransfermarktServer,
  McpUfcStatsServer,
} from './scrapers/index.js';

/**
 * Single-process dispatcher for the MCP fleet.
 *
 * Docker runs the same image ten times, each with `SCRAPER_ID` set to the
 * scraper it should host. Exact same binary across services keeps deploy
 * simple and ensures rate-limit + logging wiring stays uniform.
 */

type Factory = (redis: ReturnType<typeof createRedisClient>) => McpScraperServer;

const FACTORIES: Readonly<Record<string, Factory>> = {
  'mcp-fbref': (r) => new McpFbrefServer(r),
  'mcp-sofascore': (r) => new McpSofaScoreServer(r),
  'mcp-transfermarkt': (r) => new McpTransfermarktServer(r),
  'mcp-rotowire': (r) => new McpRotowireServer(r),
  'mcp-espn-full': (r) => new McpEspnFullServer(r),
  'mcp-cricinfo': (r) => new McpCricinfoServer(r),
  'mcp-cricbuzz': (r) => new McpCricbuzzServer(r),
  'mcp-ufc-stats': (r) => new McpUfcStatsServer(r),
  'mcp-tapology': (r) => new McpTapologyServer(r),
  'mcp-boxrec': (r) => new McpBoxrecServer(r),
};

async function main(): Promise<void> {
  const scraperId = process.env['SCRAPER_ID'];
  if (!scraperId) {
    console.error('SCRAPER_ID env var is required (one of: ' + Object.keys(FACTORIES).join(', ') + ')');
    process.exit(1);
  }
  const factory = FACTORIES[scraperId];
  if (!factory) {
    console.error(`unknown SCRAPER_ID: ${scraperId}`);
    process.exit(1);
  }

  const redis = createRedisClient();
  const server = factory(redis);

  try {
    await server.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${scraperId}] failed to start: ${msg}`);
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[${scraperId}] received ${signal}, shutting down`);
    try {
      await server.stop();
      await redis.quit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${scraperId}] shutdown error: ${msg}`);
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
  console.error(`[mcp-fleet] fatal: ${msg}`);
  process.exit(1);
});
