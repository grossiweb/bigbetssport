import type { SourceConfig, SportType } from '@bbs/shared';

/**
 * The 20-source catalogue for Big Ball Sports.
 *
 *   tier 1 = unlimited / effectively-free sources (no daily cap).
 *   tier 2 = capped freemium sources. Watch the daily/perMinute caps.
 *
 * `dailyCap = 0` means "no daily limit" (tier 1 convention). `perMinuteCap`
 * is always enforced. SourceConfig.envKey names the env var that holds the
 * secret token — for open APIs where no token is required, the envKey is
 * present but can be blank in `.env`.
 *
 * Coverage (which fields each source serves) is tracked separately in
 * `field-registry.ts` — we prefer the inverse (field → priority-ordered
 * sources) because the router queries it that way.
 */

const ALL_SPORTS: readonly SportType[] = [
  'football',
  'basketball',
  'baseball',
  'ice_hockey',
  'cricket',
  'mma',
  'boxing',
  'esports',
  'formula1',
  'american_football',
  'rugby',
] as const;

// ---------------------------------------------------------------------------
// TIER 1 — unlimited / free
// ---------------------------------------------------------------------------

const nhlApi: SourceConfig = {
  id: 'nhl-api',
  name: 'NHL Stats API',
  baseUrl: 'https://api-web.nhle.com/v1',
  authHeader: '',
  envKey: 'NHL_API_KEY',
  dailyCap: 0,
  perMinuteCap: 25,
  hasDelta: true,
  hasIncludes: false,
  maxPageSize: 500,
  sports: ['ice_hockey'],
  tier: 1,
};

const mlbApi: SourceConfig = {
  id: 'mlb-api',
  name: 'MLB StatsAPI',
  baseUrl: 'https://statsapi.mlb.com/api/v1',
  authHeader: '',
  envKey: 'MLB_API_KEY',
  dailyCap: 0,
  perMinuteCap: 30,
  hasDelta: true,
  hasIncludes: true,
  maxPageSize: 1000,
  sports: ['baseball'],
  tier: 1,
};

/**
 * [UNOFFICIAL] — stats.nba.com has no supported public API. Rate limits are
 * informal and enforcement is opaque. Expect periodic IP-blocks.
 */
const nbaApi: SourceConfig = {
  id: 'nba-api',
  name: 'NBA stats (unofficial)',
  baseUrl: 'https://stats.nba.com/stats',
  authHeader: '',
  envKey: 'NBA_API_KEY',
  dailyCap: 0,
  perMinuteCap: 20,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['basketball'],
  tier: 1,
};

const openLigaDb: SourceConfig = {
  id: 'openligadb',
  name: 'OpenLigaDB',
  baseUrl: 'https://api.openligadb.de',
  authHeader: '',
  envKey: 'OPENLIGADB_KEY',
  dailyCap: 0,
  perMinuteCap: 60,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['football'],
  tier: 1,
};

const fpl: SourceConfig = {
  id: 'fpl',
  name: 'Fantasy Premier League',
  baseUrl: 'https://fantasy.premierleague.com',
  authHeader: '',
  envKey: 'FPL_API_KEY',
  dailyCap: 0,
  perMinuteCap: 50,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['football'],
  tier: 1,
};

const openF1: SourceConfig = {
  id: 'openf1',
  name: 'OpenF1',
  baseUrl: 'https://api.openf1.org/v1',
  authHeader: '',
  envKey: 'OPENF1_API_KEY',
  dailyCap: 0,
  perMinuteCap: 20,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['formula1'],
  tier: 1,
};

const cfl: SourceConfig = {
  id: 'cfl',
  name: 'CFL API',
  baseUrl: 'https://api.cfl.ca/v1',
  authHeader: '',
  envKey: 'CFL_API_KEY',
  dailyCap: 0,
  perMinuteCap: 20,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['american_football'],
  tier: 1,
};

const cfb: SourceConfig = {
  id: 'cfb',
  name: 'CollegeFootballData.com',
  baseUrl: 'https://api.collegefootballdata.com/v1',
  authHeader: 'Authorization',
  envKey: 'CFB_API_KEY',
  dailyCap: 0,
  perMinuteCap: 20,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 200,
  sports: ['american_football'],
  tier: 1,
};

// ---------------------------------------------------------------------------
// TIER 2 — capped freemium
// ---------------------------------------------------------------------------

/**
 * NOTE: `dailyCap = 20000` represents DATA POINTS not requests. Use
 * `RateLimitOrchestrator.succeeded(sourceId, datapointsUsed)` to deduct
 * the right amount after each response.
 */
const theRundown: SourceConfig = {
  id: 'therundown',
  name: 'TheRundown',
  baseUrl: 'https://therundown.io/api/v2',
  authHeader: 'X-TheRundown-Key',
  envKey: 'RUNDOWN_API_KEY',
  dailyCap: 20_000,
  perMinuteCap: 60,
  hasDelta: true,
  hasIncludes: false,
  maxPageSize: 500,
  sports: [
    'football',
    'basketball',
    'baseball',
    'ice_hockey',
    'american_football',
    'mma',
    'boxing',
  ],
  tier: 2,
};

const apiSports: SourceConfig = {
  id: 'api-sports',
  name: 'API-Sports (api-football)',
  baseUrl: 'https://v3.football.api-sports.io',
  authHeader: 'x-apisports-key',
  envKey: 'API_SPORTS_KEY',
  dailyCap: 100,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: true,
  maxPageSize: 100,
  sports: ['football'],
  tier: 2,
};

const theSportsDb: SourceConfig = {
  id: 'thesportsdb',
  name: 'TheSportsDB',
  baseUrl: 'https://www.thesportsdb.com/api/v1/json',
  authHeader: '',
  envKey: 'THESPORTSDB_API_KEY',
  dailyCap: 500,
  perMinuteCap: 30,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ALL_SPORTS,
  tier: 2,
};

/**
 * [ASSUMED] — balldontlie.io's published free-tier limit is not formally
 * documented. 300/day and 60/min are conservative community estimates;
 * adjust once we get a contract confirmation.
 */
const ballDontLie: SourceConfig = {
  id: 'balldontlie',
  name: 'balldontlie',
  baseUrl: 'https://api.balldontlie.io/v1',
  authHeader: 'Authorization',
  envKey: 'BALLDONTLIE_API_KEY',
  dailyCap: 300,
  perMinuteCap: 60,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['basketball'],
  tier: 2,
};

/**
 * NOTE: The Sportmonks free plan covers Danish Superliga (league id 271)
 * and Scottish Premiership (league id 501) ONLY. Queries scoped to other
 * leagues will be rejected by the upstream regardless of quota.
 */
const sportmonks: SourceConfig = {
  id: 'sportmonks',
  name: 'Sportmonks Soccer',
  baseUrl: 'https://soccer.sportmonks.com/api/v3.0',
  authHeader: '',
  envKey: 'SPORTMONKS_API_KEY',
  dailyCap: 200,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: true,
  maxPageSize: 100,
  sports: ['football'],
  tier: 2,
};

/**
 * NOTE: `dailyCap = 300` is the published quota, but the true bottleneck is
 * the 10-per-minute cap. Both are enforced.
 */
const footballData: SourceConfig = {
  id: 'football-data',
  name: 'football-data.org',
  baseUrl: 'https://api.football-data.org/v4',
  authHeader: 'X-Auth-Token',
  envKey: 'FOOTBALL_DATA_KEY',
  dailyCap: 300,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['football'],
  tier: 2,
};

const highlightly: SourceConfig = {
  id: 'highlightly',
  name: 'Highlightly',
  baseUrl: 'https://highlightly.net/api/v1',
  authHeader: 'x-rapidapi-key',
  envKey: 'HIGHLIGHTLY_API_KEY',
  dailyCap: 500,
  perMinuteCap: 20,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['football', 'basketball', 'american_football', 'baseball', 'ice_hockey'],
  tier: 2,
};

const isports: SourceConfig = {
  id: 'isports',
  name: 'iSports',
  baseUrl: 'https://api.isports.com/v1',
  authHeader: 'x-api-key',
  envKey: 'ISPORTS_API_KEY',
  dailyCap: 200,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['football', 'basketball'],
  tier: 2,
};

const sportsrc: SourceConfig = {
  id: 'sportsrc',
  name: 'SportsRC',
  baseUrl: 'https://api.sportsrc.com/v1',
  authHeader: 'x-api-key',
  envKey: 'SPORTSRC_API_KEY',
  dailyCap: 0,
  perMinuteCap: 60,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ALL_SPORTS,
  tier: 2,
};

const pandascore: SourceConfig = {
  id: 'pandascore',
  name: 'PandaScore',
  baseUrl: 'https://api.pandascore.co',
  authHeader: 'Authorization',
  envKey: 'PANDASCORE_API_KEY',
  dailyCap: 200,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['esports'],
  tier: 2,
};

/**
 * [UNVERIFIED] — cricketdata.org free tier limits are not confirmed by the
 * vendor in writing. Treat the caps as a best-guess until contract review.
 */
const cricketData: SourceConfig = {
  id: 'cricketdata',
  name: 'CricketData',
  baseUrl: 'https://api.cricketdata.org',
  authHeader: 'x-api-key',
  envKey: 'CRICKETDATA_API_KEY',
  dailyCap: 100,
  perMinuteCap: 10,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 100,
  sports: ['cricket'],
  tier: 2,
};

/**
 * [COMMUNITY, UNRELIABLE] — mmaapi.com is a community-maintained endpoint
 * with no SLA. Expect intermittent downtime; circuit breaker should open
 * aggressively and we should rely on MCP scrapers as the real source of
 * truth for combat sports.
 */
const mmaApi: SourceConfig = {
  id: 'mmaapi',
  name: 'MMA API (community)',
  baseUrl: 'https://www.mmaapi.com',
  authHeader: '',
  envKey: 'MMAAPI_KEY',
  dailyCap: 50,
  perMinuteCap: 5,
  hasDelta: false,
  hasIncludes: false,
  maxPageSize: 50,
  sports: ['mma'],
  tier: 2,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SOURCES: Readonly<Record<string, SourceConfig>> = Object.freeze({
  'nhl-api': nhlApi,
  'mlb-api': mlbApi,
  'nba-api': nbaApi,
  openligadb: openLigaDb,
  fpl,
  openf1: openF1,
  cfl,
  cfb,
  therundown: theRundown,
  'api-sports': apiSports,
  thesportsdb: theSportsDb,
  balldontlie: ballDontLie,
  sportmonks,
  'football-data': footballData,
  highlightly,
  isports,
  sportsrc,
  pandascore,
  cricketdata: cricketData,
  mmaapi: mmaApi,
});

export type SourceId = keyof typeof SOURCES;

export function getSource(id: string): SourceConfig | undefined {
  return SOURCES[id];
}

export function requireSource(id: string): SourceConfig {
  const source = SOURCES[id];
  if (!source) throw new Error(`unknown source: ${id}`);
  return source;
}

export const ALL_SOURCE_IDS: readonly string[] = Object.freeze(Object.keys(SOURCES));
