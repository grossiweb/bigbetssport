import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.football-data.org/v4';

/**
 * football-data.org adapter. Tier-2, football only.
 *
 * Field coverage: historical, standings.
 * Requires `X-Auth-Token` header — injected by the router.
 */
const footballDataAdapter: SourceAdapter = {
  sourceId: 'football-data',
  confidence: 0.85,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'football') return null;

    switch (field) {
      case 'historical':
        if (!params.leagueId) return null;
        return getRequest(
          urlWithQuery(
            `${BASE}/competitions/${encodeURIComponent(params.leagueId)}/matches`,
            { season: params.season },
          ),
        );

      case 'standings':
        if (!params.leagueId) return null;
        return getRequest(
          urlWithQuery(
            `${BASE}/competitions/${encodeURIComponent(params.leagueId)}/standings`,
            { season: params.season },
          ),
        );

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    switch (field) {
      case 'historical':
        return pick(data, 'matches') ?? null;
      case 'standings':
        return pick(data, 'standings') ?? null;
      default:
        return null;
    }
  },
};

export default footballDataAdapter;
