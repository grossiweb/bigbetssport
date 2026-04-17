import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { ScheduleFetcher, SCHEDULE_TIER1_HOSTS } from './schedule-fetcher.js';

/**
 * All non-tier-1 hostnames. If the fetcher accidentally contacts any of
 * these, the test harness should surface it loudly — that's the whole
 * point of the tier-1 rule.
 */
const BANNED_HOSTS = [
  'therundown.io',
  'v3.football.api-sports.io',
  'soccer.sportmonks.com',
  'api.football-data.org',
  'api.balldontlie.io',
  'highlightly.net',
  'api.isports.com',
  'api.sportsrc.com',
  'api.pandascore.co',
  'api.cricketdata.org',
  'www.mmaapi.com',
];

// Fixed "now" so OpenLigaDB season and the date filter are deterministic.
const NOW_ISO = '2024-10-15T19:00:00.000Z';
const TODAY = '2024-10-15';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('ScheduleFetcher — tier-1 routing', () => {
  let redis: Redis;
  let calledHosts: Set<string>;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    calledHosts = new Set();
    // Guard rails: trip any banned host loudly if somehow hit.
    for (const host of BANNED_HOSTS) {
      server.use(
        http.all(`https://${host}/*`, () => {
          throw new Error(`BANNED: paid source ${host} called during schedule fetch`);
        }),
      );
    }
    server.events.on('request:start', ({ request }) => {
      calledHosts.add(new URL(request.url).host);
    });
  });

  afterEach(async () => {
    await redis.quit();
    server.events.removeAllListeners();
  });

  it('ice_hockey → NHL /schedule/{date}; no paid sources contacted', async () => {
    server.use(
      http.get('https://api-web.nhle.com/v1/schedule/:date', () =>
        HttpResponse.json({
          games: [
            {
              id: 9001,
              startTimeUTC: `${TODAY}T23:00:00Z`,
              homeTeam: { name: { default: 'Toronto Maple Leafs' } },
              awayTeam: { name: { default: 'Montreal Canadiens' } },
            },
          ],
        }),
      ),
    );

    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    const fixtures = await fetcher.fetchTodayFixtures('ice_hockey');

    expect(fixtures.map((f) => f.eventId)).toEqual(['9001']);
    expect(fixtures[0]?.homeTeam).toBe('Toronto Maple Leafs');
    expect(calledHosts.has('api-web.nhle.com')).toBe(true);
    for (const banned of BANNED_HOSTS) {
      expect(calledHosts.has(banned)).toBe(false);
    }
  });

  it('baseball → MLB /schedule; parses dates[].games', async () => {
    server.use(
      http.get('https://statsapi.mlb.com/api/v1/schedule', () =>
        HttpResponse.json({
          dates: [
            {
              date: TODAY,
              games: [
                {
                  gamePk: 7777,
                  gameDate: `${TODAY}T23:15:00Z`,
                  teams: {
                    home: { team: { name: 'New York Yankees' } },
                    away: { team: { name: 'Boston Red Sox' } },
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    const fixtures = await fetcher.fetchTodayFixtures('baseball');
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.eventId).toBe('7777');
    expect(fixtures[0]?.homeTeam).toBe('New York Yankees');
  });

  it('football → OpenLigaDB, filters to today', async () => {
    server.use(
      http.get('https://api.openligadb.de/getmatchdata/bl1/:season', () =>
        HttpResponse.json([
          {
            matchID: 101,
            matchDateTimeUTC: `${TODAY}T18:30:00Z`,
            leagueName: 'Bundesliga',
            team1: { teamName: 'FC Bayern' },
            team2: { teamName: 'Borussia Dortmund' },
          },
          {
            matchID: 102,
            matchDateTimeUTC: '2024-10-22T18:30:00Z', // different date
            leagueName: 'Bundesliga',
            team1: { teamName: 'RB Leipzig' },
            team2: { teamName: 'Union Berlin' },
          },
        ]),
      ),
    );

    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    const fixtures = await fetcher.fetchTodayFixtures('football');
    expect(fixtures.map((f) => f.eventId)).toEqual(['101']);
  });

  it('sports without a tier-1 source return empty without calling anything', async () => {
    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    const fixtures = await fetcher.fetchTodayFixtures('basketball');
    expect(fixtures).toEqual([]);
    expect(calledHosts.size).toBe(0);
  });

  it('cricket / mma / american_football / others → empty + zero upstream calls', async () => {
    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    for (const sport of ['cricket', 'mma', 'boxing', 'american_football', 'esports'] as const) {
      const fixtures = await fetcher.fetchTodayFixtures(sport);
      expect(fixtures).toEqual([]);
    }
    expect(calledHosts.size).toBe(0);
  });

  it('second call hits the 4h Redis cache — no re-fetch', async () => {
    let calls = 0;
    server.use(
      http.get('https://api-web.nhle.com/v1/schedule/:date', () => {
        calls += 1;
        return HttpResponse.json({ games: [] });
      }),
    );

    const fetcher = new ScheduleFetcher(redis, () => new Date(NOW_ISO));
    await fetcher.fetchTodayFixtures('ice_hockey');
    await fetcher.fetchTodayFixtures('ice_hockey');
    await fetcher.fetchTodayFixtures('ice_hockey');

    expect(calls).toBe(1);
  });

  it('exports tier-1 hostname allow-list for external assertions', () => {
    expect(SCHEDULE_TIER1_HOSTS).toContain('api-web.nhle.com');
    expect(SCHEDULE_TIER1_HOSTS).toContain('statsapi.mlb.com');
    expect(SCHEDULE_TIER1_HOSTS).toContain('api.openligadb.de');
    for (const banned of BANNED_HOSTS) {
      expect(SCHEDULE_TIER1_HOSTS).not.toContain(banned);
    }
  });
});
