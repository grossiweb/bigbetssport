import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick } from '../helpers.js';

const BASE = 'https://fantasy.premierleague.com/api';

/**
 * Fantasy Premier League adapter. Unauthenticated public endpoints — free.
 *
 * Field coverage: scores, lineups, players, injuries, standings.
 */
const fplAdapter: SourceAdapter = {
  sourceId: 'fpl',
  confidence: 0.85,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'football') return null;

    switch (field) {
      case 'players':
      case 'injuries':
      case 'standings':
        return getRequest(`${BASE}/bootstrap-static/`);
      case 'scores':
      case 'lineups':
        return getRequest(`${BASE}/fixtures/`);
      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    switch (field) {
      case 'players':
        return pick(data, 'elements') ?? data;
      case 'injuries':
        return pick(data, 'elements') ?? data;
      case 'standings':
        return pick(data, 'teams') ?? data;
      case 'scores':
      case 'lineups':
        return Array.isArray(data) ? data : null;
      default:
        return null;
    }
  },
};

export default fplAdapter;
