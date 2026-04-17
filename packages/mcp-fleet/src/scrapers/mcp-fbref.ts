import { load, type CheerioAPI } from 'cheerio';
import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchHtml } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-fbref — scrapes https://fbref.com match pages, player career tables,
 * and historical fixtures. HTML parsing via cheerio. A 2s inter-request
 * delay is enforced to stay well below their unpublished rate threshold.
 *
 * Rate limit: 20/hour (per-hour sliding window in Redis).
 */

const BASE = 'https://fbref.com';
const DEFAULT_INTER_REQUEST_DELAY_MS = 2_000;

/** Pull a numeric stat by the `data-stat` attribute anywhere in the doc. */
function numericStat($: CheerioAPI, statKey: string): number | null {
  const text = $(`[data-stat="${statKey}"]`).first().text().trim();
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function textStat($: CheerioAPI, statKey: string): string | null {
  const text = $(`[data-stat="${statKey}"]`).first().text().trim();
  return text || null;
}

export class McpFbrefServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-fbref';
  protected readonly port = 3101;
  protected readonly rateLimit = 20;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  /** Exposed for tests so HTML fixtures can replace real fetches. */
  public fetchHtml: (url: string) => Promise<string> = (url) => fetchHtml(url);
  /** Exposed for tests — set to 0 to skip real-time delays. */
  public interRequestDelayMs = DEFAULT_INTER_REQUEST_DELAY_MS;

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_match_stats: this.scrapeMatchStats.bind(this),
      scrape_player_career: this.scrapePlayerCareer.bind(this),
      scrape_historical_fixtures: this.scrapeHistoricalFixtures.bind(this),
    };
  }

  private async scrapeMatchStats(args: Record<string, unknown>): Promise<unknown> {
    const matchId = requireString(args, 'matchId');
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const html = await this.fetchHtml(`${BASE}/en/matches/${encodeURIComponent(matchId)}`);
    return this.parseMatchStats(html);
  }

  /**
   * Exposed for tests — parse a match HTML fragment into a stats blob.
   */
  public parseMatchStats(html: string): Record<string, unknown> {
    const $ = load(html);
    return {
      possession_home: numericStat($, 'possession'),
      shots_home: numericStat($, 'shots'),
      shots_on_target_home: numericStat($, 'shots_on_target'),
      xg_home: numericStat($, 'xg'),
      passes_home: numericStat($, 'passes'),
      progressive_passes_home: numericStat($, 'progressive_passes'),
      pressures_home: numericStat($, 'pressures'),
      // Scoreboard-level info so callers can reconcile matchId → teams.
      scorebox: {
        home: $('.scorebox strong a').eq(0).text().trim() || null,
        away: $('.scorebox strong a').eq(1).text().trim() || null,
        date: textStat($, 'date') ?? $('meta[property="article:published_time"]').attr('content') ?? null,
      },
    };
  }

  private async scrapePlayerCareer(args: Record<string, unknown>): Promise<unknown> {
    const playerUrl = asString(args['playerUrl']);
    const playerName = asString(args['playerName']);
    if (!playerUrl && !playerName) {
      throw new Error('scrape_player_career requires playerUrl or playerName');
    }
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const url = playerUrl ?? `${BASE}/en/search/search.fcgi?search=${encodeURIComponent(playerName ?? '')}`;
    const html = await this.fetchHtml(url);
    return this.parsePlayerCareer(html);
  }

  public parsePlayerCareer(html: string): unknown {
    const $ = load(html);
    const seasons: Array<Record<string, string | number | null>> = [];

    $('#stats_standard_dom_lg tbody tr, #stats_standard tbody tr').each((_, row) => {
      const $row = $(row);
      if ($row.hasClass('thead')) return;
      const season = $row.find('th[data-stat="season"], th[data-stat="year_id"]').text().trim();
      if (!season) return;
      seasons.push({
        season,
        team: $row.find('[data-stat="team"], [data-stat="squad"]').text().trim() || null,
        competition: $row.find('[data-stat="comp_level"]').text().trim() || null,
        matches: toNum($row.find('[data-stat="games"]').text()),
        minutes: toNum($row.find('[data-stat="minutes"]').text()),
        goals: toNum($row.find('[data-stat="goals"]').text()),
        assists: toNum($row.find('[data-stat="assists"]').text()),
        xg: toNum($row.find('[data-stat="xg"]').text()),
      });
    });

    return { seasons };
  }

  private async scrapeHistoricalFixtures(args: Record<string, unknown>): Promise<unknown> {
    const competitionUrl = requireString(args, 'competitionUrl');
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const html = await this.fetchHtml(competitionUrl);
    return this.parseHistoricalFixtures(html);
  }

  public parseHistoricalFixtures(html: string): unknown {
    const $ = load(html);
    const fixtures: Array<Record<string, string | null>> = [];
    $('table.stats_table tbody tr').each((_, row) => {
      const $row = $(row);
      const date = $row.find('[data-stat="date"]').text().trim();
      const home = $row.find('[data-stat="home_team"]').text().trim();
      const away = $row.find('[data-stat="away_team"]').text().trim();
      if (!date || !home || !away) return;
      fixtures.push({
        date,
        home,
        away,
        score: $row.find('[data-stat="score"]').text().trim() || null,
        venue: $row.find('[data-stat="venue"]').text().trim() || null,
      });
    });
    return { fixtures };
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

function toNum(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export default McpFbrefServer;
