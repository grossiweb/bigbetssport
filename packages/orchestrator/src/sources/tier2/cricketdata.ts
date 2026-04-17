import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

/**
 * CricketData.org adapter.
 *
 * Auth is via a URL-query `apikey` param (not a header). The adapter reads
 * `CRICKETDATA_API_KEY` directly from the env so the request's final URL
 * contains the secret — the router's header-inject path is skipped.
 *
 * Field coverage (ordered by priority in FIELD_REGISTRY):
 *   scores     → /matches?offset=0
 *   stats      → /match_scorecard?id={matchId}
 *   players    → /players?id={playerId}
 *   standings  → /series_standings?id={seriesId}
 *
 * Free-tier quota limits are undocumented by the vendor. We warn once on
 * first use to remind operators to watch the dashboard.
 */

const BASE = 'https://api.cricapi.com/v1';
const ENV_KEY = 'CRICKETDATA_API_KEY';

/** When true, the first adapter call logs a one-time warning. */
export const FREE_TIER_LIMITS_UNKNOWN = true;
let warned = false;

function apiKey(): string {
  return process.env[ENV_KEY] ?? '';
}

function warnOnce(): void {
  if (!FREE_TIER_LIMITS_UNKNOWN || warned) return;
  warned = true;
  console.warn(
    '[cricketdata] free-tier quota limits are undocumented; watch the dashboard',
  );
}

const cricketDataAdapter: SourceAdapter = {
  sourceId: 'cricketdata',
  confidence: 0.75,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'cricket') return null;
    const key = apiKey();
    if (!key) return null;
    warnOnce();

    switch (field) {
      case 'scores':
        return getRequest(urlWithQuery(`${BASE}/matches`, { apikey: key, offset: 0 }));

      case 'stats': {
        if (!params.matchId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/match_scorecard`, { apikey: key, id: params.matchId }),
        );
      }

      case 'players': {
        if (!params.playerId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/players`, { apikey: key, id: params.playerId }),
        );
      }

      case 'standings': {
        if (!params.leagueId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/series_standings`, { apikey: key, id: params.leagueId }),
        );
      }

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    const status = pick<string>(data, 'status');
    if (typeof status === 'string' && status.toLowerCase().startsWith('fail')) {
      return null;
    }
    const payload = pick(data, 'data');
    if (payload === null) return null;

    switch (field) {
      case 'scores':
        return Array.isArray(payload) ? payload : [payload];
      case 'stats':
      case 'players':
      case 'standings':
        return payload;
      default:
        return null;
    }
  },
};

export default cricketDataAdapter;
