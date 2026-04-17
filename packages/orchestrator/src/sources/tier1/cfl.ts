import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, urlWithQuery, pick } from '../helpers.js';

const BASE = 'https://api.cfl.ca/v1';

/**
 * Canadian Football League adapter. Not yet routed via FIELD_REGISTRY.
 */
const cflAdapter: SourceAdapter = {
  sourceId: 'cfl',
  confidence: 0.9,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'american_football') return null;
    switch (field) {
      case 'scores':
      case 'historical':
        return getRequest(urlWithQuery(`${BASE}/games`, { season: params.season }));
      case 'standings':
        return getRequest(urlWithQuery(`${BASE}/standings`, { season: params.season }));
      default:
        return null;
    }
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return pick(data, 'data') ?? data;
  },
};

export default cflAdapter;
