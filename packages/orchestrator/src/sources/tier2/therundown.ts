import type { FieldKey, FetchParams, SportType } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://therundown.io/api/v2';
const AUTH_HEADER = 'X-TheRundown-Key';
const ENV_KEY = 'RUNDOWN_API_KEY';

/**
 * Map of BBS `SportType` → TheRundown sport id (or list of football league ids).
 * Exported so the delta poller can iterate over it independently.
 */
export const THERUNDOWN_SPORT_IDS: Readonly<Record<SportType, readonly number[]>> = {
  football: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  basketball: [4],
  baseball: [3],
  ice_hockey: [6],
  american_football: [2],
  mma: [7],
  boxing: [9],
  // Not covered by TheRundown
  cricket: [],
  esports: [],
  formula1: [],
  rugby: [],
};

/**
 * TheRundown adapter — tier-2 odds + scores + delta source.
 *
 * Field coverage: scores, odds.
 */
const theRundownAdapter: SourceAdapter = {
  sourceId: 'therundown',
  confidence: 0.85,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    const ids = THERUNDOWN_SPORT_IDS[params.sport];
    if (!ids || ids.length === 0) return null;

    const sportId = ids[0];
    if (sportId === undefined) return null;

    if (field !== 'scores' && field !== 'odds') return null;

    const date = params.date ?? new Date().toISOString().slice(0, 10);
    const url = urlWithQuery(
      `${BASE}/sports/${sportId}/events/${encodeURIComponent(date)}`,
      {
        include: 'scores,all_periods',
        affiliate_ids: '19,23',
        market_ids: '1,2,3',
        main_line: 'true',
      },
    );

    // Auth header is injected by the router from sourceConfig.authHeader +
    // sourceConfig.envKey. The adapter sets any non-auth headers only.
    return getRequest(url);
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    const events = pick(data, 'events');
    if (!Array.isArray(events)) return null;
    switch (field) {
      case 'scores':
      case 'odds':
        return events;
      default:
        return null;
    }
  },
};

// ----- Delta-poller helpers (used by delta-poller.ts) ----------------------

export interface TheRundownDeltaRequest {
  readonly request: Request;
  readonly sportId: number;
}

/**
 * Build a delta request. Returned separately so the poller can inject the
 * auth header directly; it doesn't use the general adapter path.
 */
export function buildTheRundownDeltaRequest(
  sportId: number,
  cursor: string | null,
  apiKey: string | undefined,
): Request {
  const url = urlWithQuery(`${BASE}/markets/delta`, {
    last_id: cursor ?? undefined,
    sport_id: sportId,
  });
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) headers[AUTH_HEADER] = apiKey;
  return new Request(url, { method: 'GET', headers });
}

export const THERUNDOWN_AUTH_HEADER = AUTH_HEADER;
export const THERUNDOWN_ENV_KEY = ENV_KEY;
export const THERUNDOWN_BASE = BASE;

export default theRundownAdapter;
