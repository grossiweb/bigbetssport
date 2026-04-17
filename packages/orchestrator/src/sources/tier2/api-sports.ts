import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://v3.football.api-sports.io';

/**
 * API-Sports (api-football) adapter.
 *
 * Field coverage: scores, lineups, stats, injuries, transfers, standings.
 */
const apiSportsAdapter: SourceAdapter = {
  sourceId: 'api-sports',
  confidence: 0.9,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'football') return null;

    switch (field) {
      case 'scores':
        return getRequest(
          urlWithQuery(`${BASE}/fixtures`, {
            date: params.date,
            league: params.leagueId,
            season: params.season,
            id: params.matchId,
          }),
        );

      case 'lineups':
        if (!params.matchId) return null;
        return getRequest(urlWithQuery(`${BASE}/fixtures/lineups`, { fixture: params.matchId }));

      case 'stats':
        if (params.matchId) {
          return getRequest(
            urlWithQuery(`${BASE}/fixtures/statistics`, { fixture: params.matchId }),
          );
        }
        return null;

      case 'injuries':
        return getRequest(
          urlWithQuery(`${BASE}/injuries`, {
            league: params.leagueId,
            season: params.season,
            team: params.teamId,
            player: params.playerId,
          }),
        );

      case 'transfers':
        if (!params.playerId && !params.teamId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/transfers`, { player: params.playerId, team: params.teamId }),
        );

      case 'standings':
        if (!params.leagueId) return null;
        return getRequest(
          urlWithQuery(`${BASE}/standings`, {
            league: params.leagueId,
            season: params.season,
          }),
        );

      default:
        return null;
    }
  },

  extractField(_field: FieldKey, data: unknown): unknown | null {
    return pick(data, 'response') ?? null;
  },
};

export default apiSportsAdapter;
