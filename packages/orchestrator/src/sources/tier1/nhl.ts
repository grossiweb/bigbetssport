import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://api-web.nhle.com/v1';

/**
 * NHL Stats API adapter. Free, unauthenticated, official league source.
 *
 * Field coverage from FIELD_REGISTRY:
 *   scores, stats, historical, players, standings
 */
const nhlAdapter: SourceAdapter = {
  sourceId: 'nhl-api',
  confidence: 0.95,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'ice_hockey') return null;

    switch (field) {
      case 'scores':
        if (params.date) {
          return getRequest(`${BASE}/schedule/${encodeURIComponent(params.date)}`);
        }
        return getRequest(`${BASE}/scoreboard/now`);

      case 'standings':
        return getRequest(`${BASE}/standings/now`);

      case 'players':
        if (params.playerId) {
          return getRequest(
            `${BASE}/player/${encodeURIComponent(params.playerId)}/landing`,
          );
        }
        if (params.teamId) {
          return getRequest(
            `${BASE}/roster/${encodeURIComponent(params.teamId)}/current`,
          );
        }
        return null;

      case 'stats':
        if (params.playerId) {
          return getRequest(
            urlWithQuery(
              `${BASE}/player/${encodeURIComponent(params.playerId)}/game-log/now`,
              {},
            ),
          );
        }
        if (params.teamId) {
          return getRequest(
            urlWithQuery(
              `${BASE}/club-stats/${encodeURIComponent(params.teamId)}/now`,
              {},
            ),
          );
        }
        return null;

      case 'historical':
        if (params.teamId && params.season) {
          return getRequest(
            `${BASE}/club-schedule-season/${encodeURIComponent(params.teamId)}/${encodeURIComponent(params.season)}`,
          );
        }
        return null;

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;

    switch (field) {
      case 'scores':
        return pick(data, 'games') ?? pick(data, 'gameWeek') ?? data;
      case 'standings':
        return pick(data, 'standings') ?? data;
      case 'players':
        return pick(data, 'roster') ?? data;
      case 'stats':
        return pick(data, 'gameLog') ?? pick(data, 'skaters') ?? data;
      case 'historical':
        return pick(data, 'games') ?? data;
      default:
        return null;
    }
  },
};

export default nhlAdapter;
