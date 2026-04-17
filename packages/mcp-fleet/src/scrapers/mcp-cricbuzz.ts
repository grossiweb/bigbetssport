import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { fetchJson, randomDelay } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-cricbuzz — unofficial JSON endpoints for live scores and ball-by-ball
 * commentary. Rotates UAs and uses a random 2–4s inter-request delay to
 * stay under their anti-scrape heuristics.
 *
 * Rate limit: 10/hour.
 */

const BASE = 'https://www.cricbuzz.com/api';

export class McpCricbuzzServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-cricbuzz';
  protected readonly port = 3107;
  protected readonly rateLimit = 10;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchJson = <T = unknown>(url: string): Promise<T> =>
    fetchJson<T>(url, { rotateUa: true });

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_live_score: async (args) => {
        const matchId = requireString(args, 'matchId');
        await randomDelay(2_000, 4_000);
        return this.fetchJson(
          `${BASE}/cricket-match/${encodeURIComponent(matchId)}/full-commentary/0`,
        );
      },
      scrape_ball_by_ball: async (args) => {
        const matchId = requireString(args, 'matchId');
        const page = asNumber(args['page']) ?? 0;
        await randomDelay(2_000, 4_000);
        return this.fetchJson(
          `${BASE}/cricket-match/${encodeURIComponent(matchId)}/full-commentary/${page}`,
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

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default McpCricbuzzServer;
