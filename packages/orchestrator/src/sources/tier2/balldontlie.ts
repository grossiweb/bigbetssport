import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://api.balldontlie.io/v1';

/**
 * balldontlie adapter — basketball, tier-2.
 *
 * Field coverage: scores, lineups, players, stats, historical, injuries.
 */
const ballDontLieAdapter: SourceAdapter = {
  sourceId: 'balldontlie',
  confidence: 0.85,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'basketball') return null;

    switch (field) {
      case 'scores':
        return getRequest(
          urlWithQuery(`${BASE}/games`, {
            'dates[]': params.date,
            'seasons[]': params.season,
          }),
        );

      case 'players':
        if (params.playerId) {
          return getRequest(`${BASE}/players/${encodeURIComponent(params.playerId)}`);
        }
        return getRequest(
          urlWithQuery(`${BASE}/players`, {
            'team_ids[]': params.teamId,
          }),
        );

      case 'stats':
        return getRequest(
          urlWithQuery(`${BASE}/stats`, {
            'game_ids[]': params.matchId,
            'player_ids[]': params.playerId,
          }),
        );

      case 'historical':
        return getRequest(
          urlWithQuery(`${BASE}/games`, {
            'seasons[]': params.season,
            'team_ids[]': params.teamId,
          }),
        );

      case 'lineups':
        if (!params.matchId) return null;
        return getRequest(`${BASE}/games/${encodeURIComponent(params.matchId)}`);

      case 'injuries':
        return getRequest(`${BASE}/player_injuries`);

      default:
        return null;
    }
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return pick(data, 'data') ?? null;
  },
};

export default ballDontLieAdapter;
