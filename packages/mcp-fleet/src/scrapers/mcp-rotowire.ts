import { load } from 'cheerio';
import type { Redis } from 'ioredis';
import type { SportType } from '@bbs/shared';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchHtml } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-rotowire — injury reports + lineup confirmations + depth charts.
 * Sport-specific URL paths: /nfl/injuries.php, /nba/injuries.php, ...
 *
 * Rate limit: 15/hour. 2s inter-request delay.
 */

const BASE = 'https://www.rotowire.com';

const SPORT_PATH: Partial<Record<SportType, string>> = {
  american_football: 'nfl',
  basketball: 'nba',
  baseball: 'mlb',
  ice_hockey: 'nhl',
};

export class McpRotowireServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-rotowire';
  protected readonly port = 3104;
  protected readonly rateLimit = 15;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchHtml: (url: string) => Promise<string> = (url) => fetchHtml(url);

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_injury_report: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const path = SPORT_PATH[sport];
        if (!path) throw new Error(`rotowire: unsupported sport ${sport}`);
        await delay(2_000);
        const html = await this.fetchHtml(`${BASE}/${path}/injuries.php`);
        return this.parseInjuryReport(html);
      },
      scrape_lineup_confirmation: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const path = SPORT_PATH[sport];
        if (!path) throw new Error(`rotowire: unsupported sport ${sport}`);
        await delay(2_000);
        const html = await this.fetchHtml(`${BASE}/${path}/daily-lineups.php`);
        return this.parseLineups(html);
      },
      scrape_depth_chart: async (args) => {
        const sport = requireString(args, 'sport') as SportType;
        const team = requireString(args, 'teamName');
        const path = SPORT_PATH[sport];
        if (!path) throw new Error(`rotowire: unsupported sport ${sport}`);
        await delay(2_000);
        const html = await this.fetchHtml(`${BASE}/${path}/depth-charts.php?team=${encodeURIComponent(team)}`);
        return this.parseDepthChart(html);
      },
    };
  }

  public parseInjuryReport(html: string): unknown {
    const $ = load(html);
    const rows: Array<Record<string, string | null>> = [];
    $('table.no-footer tbody tr, .injury-table tbody tr').each((_, row) => {
      const $row = $(row);
      const player = $row.find('td').eq(0).text().trim();
      if (!player) return;
      rows.push({
        player,
        team: $row.find('td').eq(1).text().trim() || null,
        position: $row.find('td').eq(2).text().trim() || null,
        status: $row.find('td').eq(3).text().trim() || null,
        details: $row.find('td').eq(4).text().trim() || null,
      });
    });
    return { injuries: rows, updatedAt: new Date().toISOString() };
  }

  public parseLineups(html: string): unknown {
    const $ = load(html);
    const games: Array<Record<string, unknown>> = [];
    $('.lineup').each((_, el) => {
      const $el = $(el);
      games.push({
        home: $el.find('.lineup__team--home .lineup__abbr').text().trim() || null,
        away: $el.find('.lineup__team--away .lineup__abbr').text().trim() || null,
        starters_home: $el
          .find('.lineup__list.is-home li .lineup__player-highlight-name')
          .map((_i, n) => $(n).text().trim())
          .get(),
        starters_away: $el
          .find('.lineup__list.is-visit li .lineup__player-highlight-name')
          .map((_i, n) => $(n).text().trim())
          .get(),
      });
    });
    return { games };
  }

  public parseDepthChart(html: string): unknown {
    const $ = load(html);
    const byPosition: Record<string, string[]> = {};
    $('table.depth-chart tr').each((_, row) => {
      const $row = $(row);
      const pos = $row.find('th').first().text().trim();
      if (!pos) return;
      const players = $row
        .find('td')
        .map((_i, c) => $(c).text().trim())
        .get()
        .filter((x) => x.length > 0);
      if (players.length > 0) byPosition[pos] = players;
    });
    return { byPosition };
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

export default McpRotowireServer;
