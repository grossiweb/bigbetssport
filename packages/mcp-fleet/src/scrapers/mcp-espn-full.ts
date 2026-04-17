import type { Redis } from 'ioredis';
import type { SportType } from '@bbs/shared';
import { McpScraperServer } from '../server-base.js';
import { fetchJson } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-espn-full — ESPN's unofficial site API for game summaries, injuries,
 * and depth charts.
 *
 * @unofficial
 * @commercial-use-prohibited — ESPN's TOS does not permit commercial
 * scraping. This scraper exists for parity gap-fill only, in environments
 * where terms have been cleared.
 *
 * Rate limit: 40/hour.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** BBS sport + league → ESPN path segments `{espnSport}/{espnLeague}`. */
const ESPN_PATH: Partial<Record<`${SportType}/${string}`, string>> = {
  'american_football/nfl': 'football/nfl',
  'american_football/ncaaf': 'football/college-football',
  'basketball/nba': 'basketball/nba',
  'basketball/wnba': 'basketball/wnba',
  'baseball/mlb': 'baseball/mlb',
  'ice_hockey/nhl': 'hockey/nhl',
};

function espnPath(sport: SportType, league: string): string | null {
  return ESPN_PATH[`${sport}/${league}` as keyof typeof ESPN_PATH] ?? null;
}

export class McpEspnFullServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-espn-full';
  protected readonly port = 3105;
  protected readonly rateLimit = 40;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchJson = <T = unknown>(url: string): Promise<T> => fetchJson<T>(url);

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_game_summary: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const league = requireString(args, 'league');
        const gameId = requireString(args, 'gameId');
        const path = espnPath(sport, league);
        if (!path) throw new Error(`espn: unsupported ${sport}/${league}`);
        return this.fetchJson(
          `${BASE}/${path}/summary?event=${encodeURIComponent(gameId)}`,
        );
      },
      scrape_injury_report: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const league = requireString(args, 'league');
        const path = espnPath(sport, league);
        if (!path) throw new Error(`espn: unsupported ${sport}/${league}`);
        return this.fetchJson(`${BASE}/${path}/injuries`);
      },
      scrape_depth_chart: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const league = requireString(args, 'league');
        const teamId = requireString(args, 'teamId');
        const path = espnPath(sport, league);
        if (!path) throw new Error(`espn: unsupported ${sport}/${league}`);
        return this.fetchJson(
          `${BASE}/${path}/teams/${encodeURIComponent(teamId)}/depthcharts`,
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

export default McpEspnFullServer;
