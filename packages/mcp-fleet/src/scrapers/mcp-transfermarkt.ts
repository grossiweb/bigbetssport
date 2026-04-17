import { load } from 'cheerio';
import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchHtml } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-transfermarkt — scrapes transfermarkt.com for market values, transfer
 * history, and squad injuries. HTML is heavy and they rate-limit aggressively;
 * we rotate UAs and hold a 3s floor between requests.
 *
 * Rate limit: 10/hour.
 */

const INTER_REQUEST_DELAY_MS = 3_000;

export class McpTransfermarktServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-transfermarkt';
  protected readonly port = 3103;
  protected readonly rateLimit = 10;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchHtml: (url: string) => Promise<string> = (url) => fetchHtml(url, { rotateUa: true });

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_player_profile: async (args) => {
        const url = requireString(args, 'playerUrl');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(url);
        return this.parsePlayerProfile(html);
      },
      scrape_transfer_history: async (args) => {
        const url = requireString(args, 'playerUrl');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(url);
        return this.parseTransferHistory(html);
      },
      scrape_injury_list: async (args) => {
        const url = requireString(args, 'teamUrl');
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.fetchHtml(url);
        return this.parseInjuryList(html);
      },
    };
  }

  public parsePlayerProfile(html: string): unknown {
    const $ = load(html);
    const labelText = (label: string) =>
      $(`.info-table__content:contains("${label}")`).first().next().text().trim() || null;

    return {
      marketValue: $('.tm-player-market-value-development__current-value').text().trim() || null,
      name: $('h1.data-header__headline-wrapper').text().trim().replace(/\s+/g, ' ') || null,
      position: labelText('Position:'),
      dateOfBirth: labelText('Date of birth:'),
      citizenship: labelText('Citizenship:'),
      contractExpires: labelText('Contract expires:'),
      height: labelText('Height:'),
    };
  }

  public parseTransferHistory(html: string): unknown {
    const $ = load(html);
    const transfers: Array<Record<string, string | null>> = [];
    $('tr.transfer-history__row, .tm-player-transfer-history-grid__row').each((_, row) => {
      const $row = $(row);
      const season = $row.find('.tm-player-transfer-history-grid__season').text().trim();
      if (!season) return;
      transfers.push({
        season,
        date: $row.find('.tm-player-transfer-history-grid__date').text().trim() || null,
        from: $row.find('.tm-player-transfer-history-grid__old-club').text().trim() || null,
        to: $row.find('.tm-player-transfer-history-grid__new-club').text().trim() || null,
        fee: $row.find('.tm-player-transfer-history-grid__fee').text().trim() || null,
      });
    });
    return { transfers };
  }

  public parseInjuryList(html: string): unknown {
    const $ = load(html);
    const injuries: Array<Record<string, string | null>> = [];
    $('table.items tbody tr').each((_, row) => {
      const $row = $(row);
      const player = $row.find('td.hauptlink a').first().text().trim();
      if (!player) return;
      injuries.push({
        player,
        injury: $row.find('td').eq(3).text().trim() || null,
        since: $row.find('td').eq(4).text().trim() || null,
        expectedReturn: $row.find('td').eq(5).text().trim() || null,
      });
    });
    return {
      returnDate: new Date().toISOString(),
      injuries,
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

export default McpTransfermarktServer;
