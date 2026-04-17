import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';
import { getRequest, pick, urlWithQuery } from '../helpers.js';

const BASE = 'https://stats.nba.com/stats';

/**
 * NBA stats adapter.
 *
 * @unofficial stats.nba.com has no public-API contract. It blocks clients
 * that don't set a browser-like User-Agent and Referer — both headers are
 * always included, and the fail mode is opaque (HTTP 200 with empty body or
 * intermittent 403s). The circuit breaker should be aggressive here.
 *
 * Field coverage: scores, players.
 */
const NBA_HEADERS: Readonly<Record<string, string>> = {
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
};

function formatNbaDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

const nbaAdapter: SourceAdapter = {
  sourceId: 'nba-api',
  confidence: 0.95,

  buildRequest(field: FieldKey, params: FetchParams): Request | null {
    if (params.sport !== 'basketball') return null;

    switch (field) {
      case 'scores': {
        const gameDate = params.date ? formatNbaDate(params.date) : undefined;
        return getRequest(
          urlWithQuery(`${BASE}/scoreboardv3`, {
            GameDate: gameDate,
            LeagueID: '00',
          }),
          NBA_HEADERS,
        );
      }

      case 'players':
        if (params.playerId) {
          return getRequest(
            urlWithQuery(`${BASE}/commonplayerinfo`, {
              PlayerID: params.playerId,
            }),
            NBA_HEADERS,
          );
        }
        if (params.teamId) {
          return getRequest(
            urlWithQuery(`${BASE}/commonteamroster`, {
              TeamID: params.teamId,
              Season: params.season,
            }),
            NBA_HEADERS,
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
      case 'scores': {
        const scoreboard = pick(data, 'scoreboard');
        if (scoreboard !== null) {
          return pick(scoreboard, 'games') ?? scoreboard;
        }
        return pick(data, 'resultSets') ?? data;
      }
      case 'players':
        return pick(data, 'resultSets') ?? data;
      default:
        return null;
    }
  },
};

export default nbaAdapter;
