import { load } from 'cheerio';
import type { Redis } from 'ioredis';
import { McpScraperServer } from '../server-base.js';
import { delay, rotateUserAgent } from '../helpers.js';
import type { ToolHandler } from '../rpc.js';

/**
 * mcp-boxrec — BoxRec.com fighter records and bout results.
 *
 * @requires-credentials BoxRec credentials in BOXREC_USERNAME / BOXREC_PASSWORD.
 *                       We authenticate once and cache the session cookie.
 * @rate-limit 3/hour — BoxRec is the strictest source; use sparingly.
 *
 * Login flow:
 *   POST /en/login with form-data (_username, _password, login[go])
 *   → response sets PHPSESSID cookie → cache for session lifetime.
 */

const BASE = 'https://boxrec.com';
const LOGIN_PATH = '/en/login';
const INTER_REQUEST_DELAY_MS = 3_000;

export class McpBoxrecServer extends McpScraperServer {
  protected readonly scraperId = 'mcp-boxrec';
  protected readonly port = 3110;
  protected readonly rateLimit = 3;
  protected readonly tools: Readonly<Record<string, ToolHandler>>;

  private sessionCookie: string | null = null;

  public fetch = globalThis.fetch.bind(globalThis);

  constructor(redis: Redis) {
    super(redis);
    this.tools = {
      scrape_fighter_record: async (args) => {
        const id = requireString(args, 'boxrecId');
        await this.ensureAuth();
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.authedFetchHtml(`${BASE}/en/box-pro/${encodeURIComponent(id)}`);
        return this.parseFighterRecord(html);
      },
      scrape_bout_result: async (args) => {
        const boutId = requireString(args, 'boutId');
        await this.ensureAuth();
        await delay(INTER_REQUEST_DELAY_MS);
        const html = await this.authedFetchHtml(`${BASE}/en/event/${encodeURIComponent(boutId)}`);
        return this.parseBoutResult(html);
      },
    };
  }

  private async ensureAuth(): Promise<void> {
    if (this.sessionCookie) return;
    const user = process.env['BOXREC_USERNAME'];
    const pass = process.env['BOXREC_PASSWORD'];
    if (!user || !pass) {
      throw new Error('BoxRec credentials missing (BOXREC_USERNAME / BOXREC_PASSWORD)');
    }

    const form = new URLSearchParams();
    form.set('_username', user);
    form.set('_password', pass);
    form.set('login[go]', '');

    const res = await this.fetch(`${BASE}${LOGIN_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': rotateUserAgent(),
      },
      body: form.toString(),
      redirect: 'manual',
    });

    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error(`BoxRec login failed: no Set-Cookie (status ${res.status})`);
    }
    // Extract PHPSESSID from the Set-Cookie header.
    const match = setCookie.match(/PHPSESSID=([^;]+)/);
    if (!match) {
      throw new Error('BoxRec login: PHPSESSID not found in Set-Cookie');
    }
    this.sessionCookie = `PHPSESSID=${match[1]}`;
  }

  private async authedFetchHtml(url: string): Promise<string> {
    if (!this.sessionCookie) throw new Error('not authenticated');
    const res = await this.fetch(url, {
      headers: {
        cookie: this.sessionCookie,
        'user-agent': rotateUserAgent(),
        accept: 'text/html',
      },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.sessionCookie = null;
      }
      throw new Error(`BoxRec HTTP ${res.status}`);
    }
    return res.text();
  }

  public parseFighterRecord(html: string): unknown {
    const $ = load(html);
    return {
      name: $('h1').first().text().trim() || null,
      record:
        $('table.dataTable tr:contains("record") td').last().text().trim() ||
        $('.profileTable td:contains("bouts")').next().text().trim() ||
        null,
      division: $('td:contains("division")').next().text().trim() || null,
      nationality: $('td:contains("nationality")').next().text().trim() || null,
    };
  }

  public parseBoutResult(html: string): unknown {
    const $ = load(html);
    const fighters = $('.titleColumn a, .fighterName')
      .map((_i, a) => $(a).text().trim())
      .get()
      .filter((x) => x.length > 0);
    return {
      fighters,
      rounds: $('td:contains("rounds")').next().text().trim() || null,
      result: $('.decision, .result').first().text().trim() || null,
      judges: $('table.judgeTable tr')
        .map((_i, row) => $(row).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((x) => x.length > 0),
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

export default McpBoxrecServer;
