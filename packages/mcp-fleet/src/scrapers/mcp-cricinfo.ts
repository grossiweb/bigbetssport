import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchJson } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-cricinfo — ESPN Cricinfo JSON endpoints for match scorecards, player
 * careers, and series fixtures.
 *
 * Notes:
 *   - Cricinfo's public pages are JS-heavy. Use their JSON backend.
 *   - Rate limit: 5/hour — the strictest of the fleet.
 *   - 5s inter-request delay.
 */

const BASE = 'https://www.espncricinfo.com';
const INTER_REQUEST_DELAY_MS = 5_000;

export class McpCricinfoServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-cricinfo';
  protected readonly port = 3106;
  protected readonly rateLimit = 5;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchJson = <T = unknown>(url: string): Promise<T> => fetchJson<T>(url);

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_scorecard: async (args) => {
        const matchId = requireString(args, 'matchId');
        await delay(INTER_REQUEST_DELAY_MS);
        return this.fetchJson(
          `${BASE}/ci/engine/match/${encodeURIComponent(matchId)}.json`,
        );
      },
      scrape_player_career: async (args) => {
        const playerId = requireString(args, 'playerId');
        await delay(INTER_REQUEST_DELAY_MS);
        return this.fetchJson(
          `${BASE}/ci/engine/player/${encodeURIComponent(playerId)}.json?class=11;template=results;type=allround`,
        );
      },
      scrape_series_fixtures: async (args) => {
        const seriesId = requireString(args, 'seriesId');
        await delay(INTER_REQUEST_DELAY_MS);
        return this.fetchJson(
          `${BASE}/ci/engine/series/${encodeURIComponent(seriesId)}.json`,
        );
      },
    };
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

export default McpCricinfoServer;
