import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const SPORT_ID_MLB = 1;

/**
 * MLB StatsAPI adapter. Free, unauthenticated, official league source.
 *
 * Field coverage: scores, stats, historical, players, standings.
 */
const mlbAdapter: SourceAdapter = {
  sourceId: 'mlb-api',
  confidence: 0.95,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'baseball') return null;

    switch (field) {
      case 'scores':
        return getRequest(
          urlWithQuery(`${BASE}/schedule`, {
            sportId: SPORT_ID_MLB,
            date: params.date,
          }),
        );

      case 'standings':
        return getRequest(
          urlWithQuery(`${BASE}/standings`, {
            leagueId: params.leagueId ?? '103,104',
            season: params.season,
          }),
        );

      case 'players':
        if (params.playerId) {
          return getRequest(`${BASE}/people/${encodeURIComponent(params.playerId)}`);
        }
        if (params.teamId) {
          return getRequest(
            urlWithQuery(`${BASE}/teams/${encodeURIComponent(params.teamId)}/roster`, {
              rosterType: 'active',
            }),
          );
        }
        return null;

      case 'stats':
        if (params.playerId) {
          return getRequest(
            urlWithQuery(`${BASE}/people/${encodeURIComponent(params.playerId)}/stats`, {
              stats: 'season',
              season: params.season,
            }),
          );
        }
        return null;

      case 'historical':
        return getRequest(
          urlWithQuery(`${BASE}/schedule`, {
            sportId: SPORT_ID_MLB,
            season: params.season,
            leagueId: params.leagueId,
          }),
        );

      default:
        return null;
    }
  },

  extractField(field: FieldKey, data: unknown): unknown | null {
    if (data === null || typeof data !== 'object') return null;
    switch (field) {
      case 'scores':
      case 'historical':
        return pick(data, 'dates') ?? data;
      case 'standings':
        return pick(data, 'records') ?? data;
      case 'players':
        return pick(data, 'roster') ?? pick(data, 'people') ?? data;
      case 'stats':
        return pick(data, 'stats') ?? data;
      default:
        return null;
    }
  },
};

export default mlbAdapter;
