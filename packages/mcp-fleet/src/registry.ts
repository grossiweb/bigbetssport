import type { FieldKey, McpScraper, SportType } from '@bbs/shared';

/**
 * Registry of MCP scraper entries consumed by the orchestrator's
 * `GapDetector`. One entry per (scraper, tool) tuple — the gap detector
 * iterates candidates, filters by `coveredFields` and `coveredSports`,
 * and calls the first that both (a) covers the request and (b) has rate
 * budget left.
 *
 * `id` is shared across a scraper's tool entries so rate-limit counters
 * accumulate per scraper process.
 *
 * Server URLs point at the ports assigned to each scraper in the
 * companion `docker-compose.mcp.yml`.
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
];

const SOCCER: readonly SportType[] = ['football'];
const NA_LEAGUES: readonly SportType[] = [
  'american_football',
  'basketball',
  'baseball',
  'ice_hockey',
];

interface McpTemplate {
  readonly id: string;
  readonly name: string;
  readonly port: number;
  readonly rateLimit: number;
}

const FBREF: McpTemplate = { id: 'mcp-fbref', name: 'FBref', port: 3101, rateLimit: 20 };
const SOFA: McpTemplate = { id: 'mcp-sofascore', name: 'SofaScore', port: 3102, rateLimit: 30 };
const TM: McpTemplate = { id: 'mcp-transfermarkt', name: 'Transfermarkt', port: 3103, rateLimit: 10 };
const ROTO: McpTemplate = { id: 'mcp-rotowire', name: 'RotoWire', port: 3104, rateLimit: 15 };
const ESPN: McpTemplate = { id: 'mcp-espn-full', name: 'ESPN (full)', port: 3105, rateLimit: 40 };
const CINFO: McpTemplate = { id: 'mcp-cricinfo', name: 'ESPN Cricinfo', port: 3106, rateLimit: 5 };
const CBUZZ: McpTemplate = { id: 'mcp-cricbuzz', name: 'Cricbuzz', port: 3107, rateLimit: 10 };
const UFC: McpTemplate = { id: 'mcp-ufc-stats', name: 'UFCStats', port: 3108, rateLimit: 10 };
const TAP: McpTemplate = { id: 'mcp-tapology', name: 'Tapology', port: 3109, rateLimit: 8 };
const BOX: McpTemplate = { id: 'mcp-boxrec', name: 'BoxRec', port: 3110, rateLimit: 3 };

function serverUrl(port: number): string {
  const host = process.env['MCP_FLEET_HOST'] ?? 'localhost';
  return `http://${host}:${port}/mcp`;
}

function entry(
  t: McpTemplate,
  tool: string,
  coveredFields: readonly FieldKey[],
  coveredSports: readonly SportType[],
): McpScraper {
  return {
    id: t.id,
    name: t.name,
    mcpServerUrl: serverUrl(t.port),
    coveredFields,
    coveredSports,
    rateLimit: t.rateLimit,
    tool,
  };
}

export const MCP_SCRAPERS: readonly McpScraper[] = Object.freeze([
  // --- FBref ---------------------------------------------------------------
  entry(FBREF, 'scrape_match_stats', ['stats', 'xg'], SOCCER),
  entry(FBREF, 'scrape_player_career', ['players', 'historical'], SOCCER),
  entry(FBREF, 'scrape_historical_fixtures', ['historical'], SOCCER),

  // --- SofaScore -----------------------------------------------------------
  entry(SOFA, 'scrape_live_match', ['scores'], ALL_SPORTS),
  entry(SOFA, 'scrape_match_lineup', ['lineups'], ALL_SPORTS),
  entry(SOFA, 'scrape_match_events', ['stats'], ALL_SPORTS),

  // --- Transfermarkt -------------------------------------------------------
  entry(TM, 'scrape_player_profile', ['players'], SOCCER),
  entry(TM, 'scrape_transfer_history', ['transfers'], SOCCER),
  entry(TM, 'scrape_injury_list', ['injuries'], SOCCER),

  // --- RotoWire ------------------------------------------------------------
  entry(ROTO, 'scrape_injury_report', ['injuries'], NA_LEAGUES),
  entry(ROTO, 'scrape_lineup_confirmation', ['lineups'], NA_LEAGUES),
  entry(ROTO, 'scrape_depth_chart', ['players'], NA_LEAGUES),

  // --- ESPN (full) ---------------------------------------------------------
  entry(ESPN, 'scrape_game_summary', ['scores', 'stats'], NA_LEAGUES),
  entry(ESPN, 'scrape_injury_report', ['injuries'], NA_LEAGUES),
  entry(ESPN, 'scrape_depth_chart', ['players'], NA_LEAGUES),

  // --- Cricinfo ------------------------------------------------------------
  entry(CINFO, 'scrape_scorecard', ['scores', 'stats'], ['cricket']),
  entry(CINFO, 'scrape_player_career', ['players', 'historical'], ['cricket']),
  entry(CINFO, 'scrape_series_fixtures', ['historical'], ['cricket']),

  // --- Cricbuzz ------------------------------------------------------------
  entry(CBUZZ, 'scrape_live_score', ['scores'], ['cricket']),
  entry(CBUZZ, 'scrape_ball_by_ball', ['stats'], ['cricket']),

  // --- UFCStats ------------------------------------------------------------
  entry(UFC, 'scrape_fight_stats', ['stats'], ['mma']),
  entry(UFC, 'scrape_event_card', ['scores'], ['mma']),
  entry(UFC, 'scrape_fighter_record', ['players'], ['mma']),

  // --- Tapology ------------------------------------------------------------
  entry(TAP, 'scrape_fighter_profile', ['players'], ['mma', 'boxing']),
  entry(TAP, 'scrape_event_results', ['historical', 'scores'], ['mma', 'boxing']),
  entry(TAP, 'scrape_rankings', ['standings'], ['mma', 'boxing']),

  // --- BoxRec --------------------------------------------------------------
  entry(BOX, 'scrape_fighter_record', ['players', 'historical'], ['boxing']),
  entry(BOX, 'scrape_bout_result', ['scores', 'stats'], ['boxing']),
]);

export const MCP_PORTS: Readonly<Record<string, number>> = Object.freeze({
  'mcp-fbref': FBREF.port,
  'mcp-sofascore': SOFA.port,
  'mcp-transfermarkt': TM.port,
  'mcp-rotowire': ROTO.port,
  'mcp-espn-full': ESPN.port,
  'mcp-cricinfo': CINFO.port,
  'mcp-cricbuzz': CBUZZ.port,
  'mcp-ufc-stats': UFC.port,
  'mcp-tapology': TAP.port,
  'mcp-boxrec': BOX.port,
});
