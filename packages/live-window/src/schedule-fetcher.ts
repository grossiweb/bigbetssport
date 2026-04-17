import type { Redis } from 'ioredis';
import type { SportType } from '@bbs/shared';
import type { Fixture } from './types.js';

/**
 * Schedule fetcher — fetches today's fixtures using only **tier-1, no-cost**
 * upstream sources. The P-05 hard rule is "never touch capped quotas for
 * schedule lookups"; paid sources (TheRundown, API-Sports, Sportmonks,
 * Football-Data, BallDontLie, Highlightly, etc.) are never contacted
 * directly here.
 *
 * Sport → endpoint (tier-1 only):
 *
 *   ice_hockey   → NHL Stats API /schedule/{date}
 *   baseball     → MLB Stats API /schedule?sportId=1&date={date}
 *   football     → OpenLigaDB /getmatchdata/bl1/{season}, filtered to today
 *
 *   american_football / basketball / cricket / others
 *                → cache-only lookup at `schedule:{sport}:{date}`.
 *                  We read what another path (the orchestrator) may have
 *                  populated, but NEVER issue a paid-source request here.
 *
 * Results are memoised in Redis at `schedule:{sport}:{date}` for 4 hours.
 */

const CACHE_TTL_SECONDS = 4 * 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;

const NHL_BASE = 'https://api-web.nhle.com/v1';
const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const OPENLIGADB_BASE = 'https://api.openligadb.de';

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function scheduleCacheKey(sport: SportType, date: string): string {
  return `schedule:${sport}:${date}`;
}

function currentSeason(now: Date): string {
  // OpenLigaDB convention: '2024' means 2024/25 season. Crudely: Aug-Dec →
  // this calendar year; Jan-Jul → previous calendar year.
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return month >= 7 ? String(year) : String(year - 1);
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class ScheduleFetcher {
  constructor(
    private readonly redis: Redis,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  async fetchTodayFixtures(sport: SportType): Promise<Fixture[]> {
    const now = this.nowFn();
    const date = todayUtc(now);
    const cacheKey = scheduleCacheKey(sport, date);

    const cached = await this.readCache(cacheKey);
    if (cached !== null) return cached;

    const fetched = await this.fetchForSport(sport, now, date);
    await this.writeCache(cacheKey, fetched);
    return fetched;
  }

  private async fetchForSport(sport: SportType, now: Date, date: string): Promise<Fixture[]> {
    try {
      switch (sport) {
        case 'ice_hockey':
          return await this.fetchNhlFixtures(date);
        case 'baseball':
          return await this.fetchMlbFixtures(date);
        case 'football':
          return await this.fetchOpenLigaDbFixtures(now, date);
        default:
          // No tier-1 source for this sport. Return empty — the caller
          // will simply fail to set a live window, which is correct.
          return [];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[schedule-fetcher:${sport}] ${msg}`);
      return [];
    }
  }

  // ---- NHL -----------------------------------------------------------------

  private async fetchNhlFixtures(date: string): Promise<Fixture[]> {
    const response = await fetchWithTimeout(`${NHL_BASE}/schedule/${encodeURIComponent(date)}`);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      gameWeek?: Array<{ date?: string; games?: unknown[] }>;
      games?: unknown[];
    };
    const games =
      data.games ??
      data.gameWeek?.find((d) => d.date === date)?.games ??
      data.gameWeek?.[0]?.games ??
      [];

    const out: Fixture[] = [];
    for (const raw of games) {
      if (raw === null || typeof raw !== 'object') continue;
      const g = raw as {
        id?: number | string;
        startTimeUTC?: string;
        homeTeam?: { name?: { default?: string } };
        awayTeam?: { name?: { default?: string } };
      };
      if (typeof g.startTimeUTC !== 'string') continue;
      const home = g.homeTeam?.name?.default;
      const away = g.awayTeam?.name?.default;
      if (!home || !away || g.id === undefined) continue;
      out.push({
        eventId: String(g.id),
        sport: 'ice_hockey',
        kickoffUtc: g.startTimeUTC,
        homeTeam: home,
        awayTeam: away,
        leagueId: 'NHL',
      });
    }
    return out;
  }

  // ---- MLB -----------------------------------------------------------------

  private async fetchMlbFixtures(date: string): Promise<Fixture[]> {
    const url = `${MLB_BASE}/schedule?sportId=1&date=${encodeURIComponent(date)}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      dates?: Array<{ games?: unknown[] }>;
    };

    const out: Fixture[] = [];
    for (const dateEntry of data.dates ?? []) {
      for (const raw of dateEntry.games ?? []) {
        if (raw === null || typeof raw !== 'object') continue;
        const g = raw as {
          gamePk?: number;
          gameDate?: string;
          teams?: {
            home?: { team?: { name?: string } };
            away?: { team?: { name?: string } };
          };
        };
        if (typeof g.gameDate !== 'string' || g.gamePk === undefined) continue;
        const home = g.teams?.home?.team?.name;
        const away = g.teams?.away?.team?.name;
        if (!home || !away) continue;
        out.push({
          eventId: String(g.gamePk),
          sport: 'baseball',
          kickoffUtc: g.gameDate,
          homeTeam: home,
          awayTeam: away,
          leagueId: 'MLB',
        });
      }
    }
    return out;
  }

  // ---- OpenLigaDB ----------------------------------------------------------

  private async fetchOpenLigaDbFixtures(now: Date, date: string): Promise<Fixture[]> {
    const season = currentSeason(now);
    const response = await fetchWithTimeout(`${OPENLIGADB_BASE}/getmatchdata/bl1/${season}`);
    if (!response.ok) return [];
    const data = (await response.json()) as unknown[];
    if (!Array.isArray(data)) return [];

    const out: Fixture[] = [];
    for (const raw of data) {
      if (raw === null || typeof raw !== 'object') continue;
      const m = raw as {
        matchID?: number;
        matchDateTimeUTC?: string;
        team1?: { teamName?: string };
        team2?: { teamName?: string };
        leagueName?: string;
      };
      if (typeof m.matchDateTimeUTC !== 'string' || m.matchID === undefined) continue;
      if (m.matchDateTimeUTC.slice(0, 10) !== date) continue;
      const home = m.team1?.teamName;
      const away = m.team2?.teamName;
      if (!home || !away) continue;
      out.push({
        eventId: String(m.matchID),
        sport: 'football',
        kickoffUtc: m.matchDateTimeUTC,
        homeTeam: home,
        awayTeam: away,
        leagueId: m.leagueName ?? 'bl1',
      });
    }
    return out;
  }

  // ---- cache ---------------------------------------------------------------

  private async readCache(key: string): Promise<Fixture[] | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      return parsed as Fixture[];
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, fixtures: Fixture[]): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(fixtures), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[schedule-fetcher:cache] ${msg}`);
    }
  }
}

export const SCHEDULE_TIER1_HOSTS: readonly string[] = [
  'api-web.nhle.com',
  'statsapi.mlb.com',
  'api.openligadb.de',
];
