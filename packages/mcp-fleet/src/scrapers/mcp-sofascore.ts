import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { fetchJson } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-sofascore — unofficial JSON API at api.sofascore.com/api/v1.
 *
 * @unofficial May break without warning; circuit breaker should be
 * aggressive when this source starts 5xx-ing.
 *
 * Rate limit: 30/hour.
 */

const BASE = 'https://api.sofascore.com/api/v1';

export class McpSofaScoreServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-sofascore';
  protected readonly port = 3102;
  protected readonly rateLimit = 30;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchJson = <T = unknown>(url: string): Promise<T> => fetchJson<T>(url);

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_live_match: async (args) => {
        const matchId = requireString(args, 'matchId');
        return this.fetchJson(`${BASE}/event/${encodeURIComponent(matchId)}`);
      },
      scrape_match_lineup: async (args) => {
        const matchId = requireString(args, 'matchId');
        return this.fetchJson(`${BASE}/event/${encodeURIComponent(matchId)}/lineups`);
      },
      scrape_match_events: async (args) => {
        const matchId = requireString(args, 'matchId');
        return this.fetchJson(`${BASE}/event/${encodeURIComponent(matchId)}/incidents`);
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

export default McpSofaScoreServer;
