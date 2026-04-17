import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

/**
 * TheSportsDB. Free plan keys the key `3` into the URL path; the router
 * can swap in a paid key via env substitution later if the envKey is set.
 *
 * Field coverage: lineups, players, transfers.
 */
const theSportsDbAdapter: SourceAdapter = {
  sourceId: 'thesportsdb',
  confidence: 0.8,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    const key = process.env['THESPORTSDB_API_KEY'] ?? '3';
    const base = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}`;

    switch (field) {
      case 'lineups':
        if (!params.matchId) return null;
        return getRequest(urlWithQuery(`${base}/lookuplineup.php`, { id: params.matchId }));

      case 'players':
        if (params.playerId) {
          return getRequest(urlWithQuery(`${base}/lookupplayer.php`, { id: params.playerId }));
        }
        if (params.teamId) {
          return getRequest(urlWithQuery(`${base}/lookup_all_players.php`, { id: params.teamId }));
        }
        return null;

      case 'transfers':
        if (!params.playerId) return null;
        return getRequest(
          urlWithQuery(`${base}/lookupcontracts.php`, { id: params.playerId }),
        );

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    switch (field) {
      case 'lineups':
        return pick(data, 'lineup') ?? pick(data, 'results') ?? null;
      case 'players':
        return pick(data, 'player') ?? pick(data, 'players') ?? null;
      case 'transfers':
        return pick(data, 'contracts') ?? null;
      default:
        return null;
    }
  },
};

export default theSportsDbAdapter;
