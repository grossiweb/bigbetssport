import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.openf1.org/v1';

/**
 * OpenF1 adapter — telemetry, sessions, drivers.
 * Not currently wired into FIELD_REGISTRY — returns null until we add F1
 * coverage to the registry. Ready for routing in a follow-up.
 */
const openF1Adapter: SourceAdapter = {
  sourceId: 'openf1',
  confidence: 0.9,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'formula1') return null;
    switch (field) {
      case 'scores':
        return getRequest(
          urlWithQuery(`${BASE}/sessions`, { session_type: 'Race', year: params.season }),
        );
      case 'players':
        return getRequest(`${BASE}/drivers`);
      default:
        return null;
    }
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return Array.isArray(data) ? data : null;
  },
};

export default openF1Adapter;
