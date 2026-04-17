import { load, type CheerioAPI } from 'cheerio';
import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, fetchHtml } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-ufc-stats — scrapes http://www.ufcstats.com for bout-level stats,
 * event cards, and fighter records. ufcstats.com serves static HTML with a
 * consistent table structure, so cheerio parsing is straightforward.
 *
 * Rate limit: 10/hour. 2s inter-request delay.
 */

const BASE = 'http://www.ufcstats.com';
const DEFAULT_INTER_REQUEST_DELAY_MS = 2_000;

export class McpUfcStatsServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-ufc-stats';
  protected readonly port = 3108;
  protected readonly rateLimit = 10;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  public fetchHtml: (url: string) => Promise<string> = (url) => fetchHtml(url);
  public interRequestDelayMs = DEFAULT_INTER_REQUEST_DELAY_MS;

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_fight_stats: this.scrapeFightStats.bind(this),
      scrape_event_card: this.scrapeEventCard.bind(this),
      scrape_fighter_record: this.scrapeFighterRecord.bind(this),
    };
  }

  private async scrapeFightStats(args: Record<string, unknown>): Promise<unknown> {
    const fightId = requireString(args, 'fightId');
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const html = await this.fetchHtml(`${BASE}/fight-details/${encodeURIComponent(fightId)}`);
    return this.parseFightStats(html);
  }

  public parseFightStats(html: string): unknown {
    const $ = load(html);
    const fighters: Array<Record<string, string | number | null>> = [];

    $('.b-fight-details__table-body .b-fight-details__table-row').each((_, row) => {
      const $row = $(row);
      const name = $row.find('.b-fight-details__table-text').first().text().trim();
      if (!name) return;
      fighters.push({
        name,
        sig_strikes: firstNumericCell($, $row, 'sig_str'),
        sig_strikes_pct: firstPctCell($, $row, 'sig_str_pct'),
        total_strikes: firstNumericCell($, $row, 'total_str'),
        takedowns: firstNumericCell($, $row, 'td'),
        takedowns_pct: firstPctCell($, $row, 'td_pct'),
        knockdowns: firstIntCell($, $row, 'kd'),
        control_time: firstTextCell($, $row, 'ctrl'),
      });
    });

    return {
      fighters,
      rounds: $('.b-fight-details__table-row_type_head').length,
      method: textAfterLabel($, 'Method'),
      round: textAfterLabel($, 'Round'),
      time: textAfterLabel($, 'Time'),
      referee: textAfterLabel($, 'Referee'),
    };
  }

  private async scrapeEventCard(args: Record<string, unknown>): Promise<unknown> {
    const eventId = requireString(args, 'eventId');
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const html = await this.fetchHtml(`${BASE}/event-details/${encodeURIComponent(eventId)}`);
    return this.parseEventCard(html);
  }

  public parseEventCard(html: string): unknown {
    const $ = load(html);
    const eventName = $('.b-content__title-highlight').text().trim();
    const eventDate =
      $('.b-list__box-list li').first().find('.b-list__box-list-item').first().text().trim() || null;
    const fights: Array<Record<string, string | number | null>> = [];

    $('tr.b-fight-details__table-row__hover').each((i, row) => {
      const $row = $(row);
      const fighterLinks = $row.find('a.b-link_style_black');
      const weightClass = $row.find('td').eq(6).text().trim() || null;
      const method = $row.find('td').eq(7).text().trim() || null;
      fights.push({
        bout_order: i + 1,
        fighter_a: fighterLinks.eq(0).text().trim() || null,
        fighter_b: fighterLinks.eq(1).text().trim() || null,
        weight_class: weightClass,
        method,
      });
    });

    return { eventName, eventDate, fights };
  }

  private async scrapeFighterRecord(args: Record<string, unknown>): Promise<unknown> {
    const fighterId = requireString(args, 'fighterId');
    if (this.interRequestDelayMs > 0) await delay(this.interRequestDelayMs);
    const html = await this.fetchHtml(`${BASE}/fighter-details/${encodeURIComponent(fighterId)}`);
    return this.parseFighterRecord(html);
  }

  public parseFighterRecord(html: string): unknown {
    const $ = load(html);
    const name = $('.b-content__title-highlight').text().trim();
    const record = $('.b-content__title-record').text().replace('Record:', '').trim() || null;

    const info: Record<string, string | null> = {};
    $('.b-list__info-box .b-list__box-list li').each((_, li) => {
      const label = $(li).find('.b-list__box-list-item-title').text().trim().replace(':', '');
      const value = $(li)
        .text()
        .replace($(li).find('.b-list__box-list-item-title').text(), '')
        .trim();
      if (label) info[label.toLowerCase()] = value || null;
    });

    return {
      name,
      record,
      height: info['height'] ?? null,
      weight: info['weight'] ?? null,
      reach: info['reach'] ?? null,
      stance: info['stance'] ?? null,
      dob: info['dob'] ?? null,
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

function cellText($: CheerioAPI, row: ReturnType<CheerioAPI>, label: string): string {
  // ufcstats uses repeating `.b-fight-details__table-col` cells; labels
  // follow a predictable order. We index by column name to stay readable.
  const order = ['fighter', 'kd', 'sig_str', 'sig_str_pct', 'total_str', 'td', 'td_pct', 'sub_att', 'rev', 'ctrl'];
  const idx = order.indexOf(label);
  if (idx < 0) return '';
  return row.find('.b-fight-details__table-col').eq(idx).text().trim();
}

function firstNumericCell(
  $: CheerioAPI,
  row: ReturnType<CheerioAPI>,
  label: string,
): number | null {
  const t = cellText($, row, label);
  const parts = t.split(' of ');
  const landed = parts[0];
  if (!landed) return null;
  const n = Number(landed);
  return Number.isFinite(n) ? n : null;
}

function firstIntCell(
  $: CheerioAPI,
  row: ReturnType<CheerioAPI>,
  label: string,
): number | null {
  const t = cellText($, row, label).split(/\s+/)[0] ?? '';
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function firstPctCell($: CheerioAPI, row: ReturnType<CheerioAPI>, label: string): string | null {
  const t = cellText($, row, label);
  return t ? t.split(/\s+/)[0] ?? null : null;
}

function firstTextCell($: CheerioAPI, row: ReturnType<CheerioAPI>, label: string): string | null {
  const t = cellText($, row, label);
  return t || null;
}

function textAfterLabel($: CheerioAPI, label: string): string | null {
  let found: string | null = null;
  $('.b-fight-details__text i').each((_, el) => {
    const $el = $(el);
    if ($el.text().trim().replace(':', '') === label) {
      // Text node after the <i> label
      const parentText = $el.parent().text();
      const labelText = $el.text();
      const rest = parentText.substring(parentText.indexOf(labelText) + labelText.length).trim();
      found = rest || null;
      return false;
    }
    return true;
  });
  return found;
}

export default McpUfcStatsServer;
