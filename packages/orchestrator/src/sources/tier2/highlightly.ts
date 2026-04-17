import type { FieldKey, FetchParams, SportType } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://highlightly.net/api/v1';

const PATH_FOR_SPORT: Partial<Record<SportType, string>> = {
  football: 'football',
  basketball: 'basketball',
  baseball: 'baseball',
  ice_hockey: 'hockey',
  american_football: 'american-football',
};

/**
 * Highlightly adapter. Tier-2 multi-sport odds/scores.
 *
 * Field coverage: odds.
 */
const highlightlyAdapter: SourceAdapter = {
  sourceId: 'highlightly',
  confidence: 0.8,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (field !== 'odds') return null;
    const sportPath = PATH_FOR_SPORT[params.sport];
    if (!sportPath) return null;

    return getRequest(
      urlWithQuery(`${BASE}/${sportPath}/odds`, {
        matchId: params.matchId,
        date: params.date,
        leagueId: params.leagueId,
      }),
    );
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return pick(data, 'data') ?? (Array.isArray(data) ? data : null);
  },
};

export default highlightlyAdapter;
