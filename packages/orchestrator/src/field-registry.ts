import type { FieldKey } from '@bbs/shared';

/**
 * Per-field cache + routing config.
 *
 *   ttlSeconds — Redis cache TTL for this field's values. 0 means the value
 *                is considered permanent (historical data, no expiry).
 *   sources    — priority-ordered source ids. The field router walks them
 *                top-to-bottom, firing the first one that passes quota and
 *                circuit-breaker checks.
 *   mcpFallback — MCP scraper ids to try when every API source is blocked
 *                or lacks coverage. MCPs are always slower and lower-quality
 *                so they only fire as a last resort.
 */
export interface FieldRegistryEntry {
  readonly ttlSeconds: number;
  readonly sources: readonly string[];
  readonly mcpFallback: readonly string[];
}

export const FIELD_REGISTRY: Readonly<Record<FieldKey, FieldRegistryEntry>> = Object.freeze({
  scores: {
    ttlSeconds: 30,
    sources: [
      'nhl-api',
      'mlb-api',
      'nba-api',
      'openligadb',
      'fpl',
      'therundown',
      'balldontlie',
      'api-sports',
      'cricketdata',
      'mmaapi',
    ],
    mcpFallback: ['mcp-sofascore', 'mcp-espn-full', 'mcp-ufc-stats', 'mcp-cricbuzz'],
  },
  /**
   * NOTE: real-time odds require paid upstream tiers. On the free tiers
   * covered here, odds carry a ~5 minute delay vs. Vegas.
   */
  odds: {
    ttlSeconds: 90,
    sources: ['therundown', 'highlightly', 'pandascore', 'sportmonks'],
    mcpFallback: ['mcp-sofascore'],
  },
  lineups: {
    ttlSeconds: 3_600,
    sources: ['balldontlie', 'api-sports', 'thesportsdb', 'sportmonks', 'fpl'],
    mcpFallback: ['mcp-sofascore', 'mcp-espn-full'],
  },
  players: {
    ttlSeconds: 86_400,
    sources: [
      'thesportsdb',
      'balldontlie',
      'nhl-api',
      'mlb-api',
      'nba-api',
      'fpl',
      'sportsrc',
      'cricketdata',
      'mmaapi',
    ],
    mcpFallback: ['mcp-transfermarkt', 'mcp-ufc-stats', 'mcp-tapology', 'mcp-boxrec'],
  },
  stats: {
    ttlSeconds: 300,
    sources: [
      'nhl-api',
      'mlb-api',
      'cfb',
      'openligadb',
      'balldontlie',
      'api-sports',
      'cricketdata',
      'mmaapi',
    ],
    mcpFallback: ['mcp-fbref', 'mcp-sofascore', 'mcp-ufc-stats', 'mcp-cricinfo'],
  },
  /**
   * Historical data is permanent — ttlSeconds = 0 signals "cache forever"
   * to the field cache layer.
   */
  historical: {
    ttlSeconds: 0,
    sources: ['nhl-api', 'mlb-api', 'cfb', 'openligadb', 'football-data', 'balldontlie'],
    mcpFallback: ['mcp-fbref'],
  },
  injuries: {
    ttlSeconds: 1_800,
    sources: ['balldontlie', 'api-sports', 'fpl'],
    mcpFallback: ['mcp-rotowire', 'mcp-espn-full'],
  },
  /**
   * NOTE: xG is not exposed on the Sportmonks free plan. If `sportmonks`
   * is the only API source and we're on free, every xG request will need
   * the fbref MCP scraper.
   */
  xg: {
    ttlSeconds: 3_600,
    sources: ['sportmonks'],
    mcpFallback: ['mcp-fbref'],
  },
  transfers: {
    ttlSeconds: 7_200,
    sources: ['thesportsdb', 'api-sports'],
    mcpFallback: ['mcp-transfermarkt'],
  },
  standings: {
    ttlSeconds: 1_800,
    sources: [
      'openligadb',
      'football-data',
      'fpl',
      'nhl-api',
      'mlb-api',
      'api-sports',
      'cricketdata',
    ],
    mcpFallback: ['mcp-tapology'],
  },
});

/**
 * Convenience lookup — returns the ordered list of API source ids for a field.
 */
export function sourcesFor(field: FieldKey): readonly string[] {
  return FIELD_REGISTRY[field].sources;
}

export function mcpFallbacksFor(field: FieldKey): readonly string[] {
  return FIELD_REGISTRY[field].mcpFallback;
}

export function ttlFor(field: FieldKey): number {
  return FIELD_REGISTRY[field].ttlSeconds;
}
