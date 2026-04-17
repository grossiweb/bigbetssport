import { load } from 'cheerio';
import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchHtml } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-tapology — scraper for tapology.com fighter profiles, event results,
 * and current rankings.
 *
 * Rate limit: 8/hour. 3s inter-request delay.
 */

const INTER_REQUEST_DELAY_MS = 3_000;
const BASE = 'https://www.tapology.com';

export class McpTapologyServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-tapology';
  protected readonly port = 3109;
  protected readonly rateLimit = 8;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchHtml: (url: string) => Promise<string> = (url) => fetchHtml(url, { rotateUa: true });

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_fighter_profile: async (args) => {
        const url = requireString(args, 'tapologyUrl');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(url);
        return this.parseFighterProfile(html);
      },
      scrape_event_results: async (args) => {
        const url = requireString(args, 'eventUrl');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(url);
        return this.parseEventResults(html);
      },
      scrape_rankings: async (args) => {
        const weightClass = requireString(args, 'weightClass');
        const sport = requireString(args, 'sport');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(
          `${BASE}/rankings/${encodeURIComponent(sport)}/${encodeURIComponent(weightClass)}`,
        );
        return this.parseRankings(html);
      },
    };
  }

  public parseFighterProfile(html: string): unknown {
    const $ = load(html);
    return {
      name: $('h1.fighterUpcomingHeader_name, h1.name').first().text().trim() || null,
      record: $('.details_two_column .record').text().trim() || null,
      nickname: $('.nickname').first().text().replace(/["“”]/g, '').trim() || null,
      birthplace: $('.details_two_column li:contains("Born:")').text().replace('Born:', '').trim() || null,
      reach: $('.details_two_column li:contains("Reach:")').text().replace('Reach:', '').trim() || null,
      recentFights: $('.fighterFightResults li')
        .map((_i, el) => $(el).text().replace(/\s+/g, ' ').trim())
        .get()
        .slice(0, 5),
    };
  }

  public parseEventResults(html: string): unknown {
    const $ = load(html);
    const fights: Array<Record<string, string | null>> = [];
    $('.fightCard_row, tr.fightCard').each((_, row) => {
      const $row = $(row);
      const fighters = $row.find('.fightCard_fighter a, .fighterA, .fighterB');
      if (fighters.length < 2) return;
      fights.push({
        fighter_a: fighters.eq(0).text().trim() || null,
        fighter_b: fighters.eq(1).text().trim() || null,
        method: $row.find('.fightCard_method').text().trim() || null,
        round: $row.find('.fightCard_round').text().trim() || null,
        time: $row.find('.fightCard_time').text().trim() || null,
      });
    });
    return { fights };
  }

  public parseRankings(html: string): unknown {
    const $ = load(html);
    const rankings: Array<Record<string, string | number>> = [];
    $('.rankingsTable tr, ol.fightRankings li').each((i, row) => {
      const name = $(row).find('.rankedFighter a, a').first().text().trim();
      if (!name) return;
      rankings.push({ rank: i + 1, fighter: name });
    });
    return { rankings };
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

export default McpTapologyServer;
