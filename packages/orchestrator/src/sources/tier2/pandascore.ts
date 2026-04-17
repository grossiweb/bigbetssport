import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.pandascore.co';

/**
 * PandaScore adapter — esports, tier-2.
 *
 * Field coverage: odds.
 */
const pandaScoreAdapter: SourceAdapter = {
  sourceId: 'pandascore',
  confidence: 0.8,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'esports') return null;
    if (field !== 'odds') return null;

    return getRequest(
      urlWithQuery(`${BASE}/matches/upcoming`, {
        'filter[id]': params.matchId,
      }),
    );
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return Array.isArray(data) ? data : null;
  },
};

export default pandaScoreAdapter;
