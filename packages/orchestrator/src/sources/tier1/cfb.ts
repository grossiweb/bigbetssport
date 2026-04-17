import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.collegefootballdata.com';

/**
 * CollegeFootballData adapter — NCAA Division I FBS.
 *
 * Field coverage: stats, historical.
 * Requires a Bearer token (envKey=CFB_API_KEY) — injected by the router.
 */
const cfbAdapter: SourceAdapter = {
  sourceId: 'cfb',
  confidence: 0.9,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'american_football') return null;
    switch (field) {
      case 'stats':
        return getRequest(
          urlWithQuery(`${BASE}/stats/season`, {
            year: params.season,
            team: params.teamId,
          }),
        );
      case 'historical':
        return getRequest(
          urlWithQuery(`${BASE}/games`, {
            year: params.season,
            team: params.teamId,
          }),
        );
      default:
        return null;
    }
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return Array.isArray(data) ? data : null;
  },
};

export default cfbAdapter;
