import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.sportsrc.com/v1';

/**
 * SportsRC adapter. Multi-sport, tier-2.
 * Field coverage: players.
 */
const sportsrcAdapter: SourceAdapter = {
  sourceId: 'sportsrc',
  confidence: 0.75,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (field !== 'players') return null;

    if (params.playerId) {
      return getRequest(`${BASE}/players/${encodeURIComponent(params.playerId)}`);
    }
    if (params.teamId) {
      return getRequest(urlWithQuery(`${BASE}/players`, { team: params.teamId }));
    }
    return null;
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return pick(data, 'data') ?? null;
  },
};

export default sportsrcAdapter;
