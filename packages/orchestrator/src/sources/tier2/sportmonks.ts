import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://soccer.sportmonks.com/api/v3.0';

/**
 * Sportmonks free-plan league whitelist.
 *
 *   271 = Danish Superliga
 *   501 = Scottish Premiership
 *
 * Any other league is a quota waste — the upstream will reject.
 */
export const SPORTMONKS_FREE_LEAGUE_IDS: ReadonlySet<string> = new Set(['271', '501']);

/**
 * Sportmonks adapter — soccer only, tier-2.
 *
 * Field coverage: odds, lineups, xg.
 *
 * hasIncludes: when asked for lineups OR stats and we have a `matchId`, we
 * combine `lineups;statistics` in one `?include=` to save quota.
 */
const sportmonksAdapter: SourceAdapter = {
  sourceId: 'sportmonks',
  confidence: 0.85,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'football') return null;

    // Free-plan league guard: refuse to even attempt a non-whitelisted league.
    if (params.leagueId !== undefined && !SPORTMONKS_FREE_LEAGUE_IDS.has(String(params.leagueId))) {
      return null;
    }

    switch (field) {
      case 'odds':
        if (!params.matchId) return null;
        return getRequest(
          urlWithQuery(
            `${BASE}/odds/pre-match/fixtures/${encodeURIComponent(params.matchId)}`,
            { markets: '1' },
          ),
        );

      case 'lineups':
      case 'stats': {
        if (!params.matchId) return null;
        // hasIncludes: one call returns lineups + statistics
        return getRequest(
          urlWithQuery(`${BASE}/fixtures/${encodeURIComponent(params.matchId)}`, {
            include: 'lineups;statistics',
          }),
        );
      }

      case 'xg':
        if (!params.matchId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/fixtures/${encodeURIComponent(params.matchId)}`, {
            include: 'expectedGoals',
          }),
        );

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    const payload = pick(data, 'data') ?? data;
    if (payload === null) return null;

    switch (field) {
      case 'odds':
        return Array.isArray(payload) ? payload : pick(payload, 'odds') ?? payload;
      case 'lineups':
        return pick(payload, 'lineups') ?? payload;
      case 'stats':
        return pick(payload, 'statistics') ?? payload;
      case 'xg':
        return pick(payload, 'expectedGoals') ?? payload;
      default:
        return null;
    }
  },
};

export default sportmonksAdapter;
