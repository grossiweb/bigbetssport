import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick } from '../helpers.js';

const BASE = 'https://api.openligadb.de';

/**
 * OpenLigaDB adapter. German football / Bundesliga open data source.
 *
 * Field coverage: scores, stats, historical, standings.
 */
const openLigaDbAdapter: SourceAdapter = {
  sourceId: 'openligadb',
  confidence: 0.9,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'football') return null;
    if (!params.leagueId || !params.season) return null;

    const league = encodeURIComponent(params.leagueId);
    const season = encodeURIComponent(params.season);

    switch (field) {
      case 'scores':
      case 'historical':
        return getRequest(`${BASE}/getmatchdata/${league}/${season}`);
      case 'standings':
        return getRequest(`${BASE}/getbltable/${league}/${season}`);
      case 'stats':
        return getRequest(`${BASE}/getmatchdata/${league}/${season}`);
      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (!Array.isArray(data)) return null;
    switch (field) {
      case 'scores':
      case 'historical':
      case 'stats':
      case 'standings':
        return data;
      default:
        return null;
    }
  },
};

// Silence unused-param warning while keeping the helper imported.
void pick;

export default openLigaDbAdapter;
