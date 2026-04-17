/**
 * Big Ball Sports TypeScript SDK — thin HTTP + WebSocket client.
 *
 * The SDK is a zero-dependency wrapper around the canonical REST API and
 * the socket.io WebSocket surface. Types are inlined so the package is
 * publishable standalone; they track the server-side shapes defined in
 * `@bbs/shared` but don't import them.
 *
 * Usage:
 *
 *   import { BigBallSportsClient } from '@bigballsports/sdk'
 *
 *   const client = new BigBallSportsClient('bbs_xxx')
 *   const matches = await client.matches.list({ sport: 'football' })
 *   const one = await client.matches.get('abc', ['scores', 'odds'])
 */

// ---------------------------------------------------------------------------
// Canonical types (snapshot of @bbs/shared — kept inline so this package can
// be published without workspace dependencies).
// ---------------------------------------------------------------------------

export type FieldKey =
  | 'scores'
  | 'odds'
  | 'lineups'
  | 'players'
  | 'stats'
  | 'historical'
  | 'injuries'
  | 'xg'
  | 'transfers'
  | 'standings';

export type SportType =
  | 'football'
  | 'basketball'
  | 'baseball'
  | 'ice_hockey'
  | 'cricket'
  | 'mma'
  | 'boxing'
  | 'esports'
  | 'formula1'
  | 'american_football'
  | 'rugby';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ResponseMeta {
  source: string;
  confidence: number;
  cached: boolean;
  cache_age_ms: number;
  request_id: string;
  fields_missing?: string[];
}

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
  error: ApiError | null;
}

export interface FieldResult<T = unknown> {
  value: T;
  source: string;
  via: 'api' | 'cache' | 'mcp';
  confidence: number;
  fetchedAt: string;
  ttlSeconds: number;
}

// ---- domain shapes used by method signatures -----------------------------

export interface Match {
  [field: string]: FieldResult | null | undefined;
}
export interface Player {
  [field: string]: FieldResult | null | undefined;
}
export interface OddsLine {
  [k: string]: unknown;
}
export interface MatchEvent {
  [k: string]: unknown;
}
export interface PlayerStats {
  [k: string]: unknown;
}
export interface Standing {
  [k: string]: unknown;
}
export interface Injury {
  [k: string]: unknown;
}
export interface LiveEvent {
  type: string;
  data: unknown;
}

// ---- method-parameter shapes ---------------------------------------------

export interface MatchListParams {
  sport: SportType;
  league?: string;
  date?: string;
  status?: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  page?: number;
  limit?: number;
}

export interface StatsParams {
  sport: SportType;
  season?: string;
  league?: string;
  page?: number;
  limit?: number;
}

export interface InjuryParams {
  sport: SportType;
  team?: string;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.bigballsports.com';

export interface ClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Optional explicit timeout in ms. Defaults to 15s. */
  readonly timeoutMs?: number;
}

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BigBallSportsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  readonly matches: MatchesApi;
  readonly players: PlayersApi;
  readonly standings: StandingsApi;
  readonly injuries: InjuriesApi;
  readonly cricket: CricketApi;
  readonly combat: CombatApi;

  constructor(
    private readonly apiKey: string,
    options: ClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;

    this.matches = new MatchesApi(this);
    this.players = new PlayersApi(this);
    this.standings = new StandingsApi(this);
    this.injuries = new InjuriesApi(this);
    this.cricket = new CricketApi(this);
    this.combat = new CombatApi(this);
  }

  /** @internal — used by the sub-APIs. */
  async get<T>(
    path: string,
    query: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>> = {},
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) url.searchParams.set(k, v.join(','));
      else url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
      const body = (await response.json()) as ApiResponse<T>;
      if (!response.ok && body?.error) {
        throw new HttpError(body.error.message, response.status, body);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @internal — used by `webhooks` + future POST endpoints. */
  async post<T>(path: string, payload: unknown): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json()) as ApiResponse<T>;
      if (!response.ok && body?.error) {
        throw new HttpError(body.error.message, response.status, body);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * WebSocket subscription helper. Connects via socket.io-client if
   * available in the runtime environment. Returns an unsubscribe fn.
   *
   * The SDK doesn't ship socket.io-client as a hard dep — callers include
   * it themselves and pass it via `options.socketIo`.
   */
  subscribe(
    room: string,
    onEvent: (event: LiveEvent) => void,
    options: { socketIo?: unknown; url?: string } = {},
  ): () => void {
    type IoFactory = (url: string, opts: Record<string, unknown>) => SocketHandle;
    const io = options.socketIo as IoFactory | undefined;
    if (!io) {
      throw new Error(
        'subscribe() requires `socketIo`: install `socket.io-client` and pass io as options.socketIo',
      );
    }
    const socketUrl = options.url ?? this.baseUrl;
    const socket = io(socketUrl, {
      path: '/socket.io',
      extraHeaders: { 'x-api-key': this.apiKey },
      auth: { apiKey: this.apiKey },
    });

    const listener = (type: string, data: unknown): void => onEvent({ type, data });
    socket.on('score_update', (d: unknown) => listener('score_update', d));
    socket.on('odds_move', (d: unknown) => listener('odds_move', d));
    socket.on('lineup_confirmed', (d: unknown) => listener('lineup_confirmed', d));
    socket.on('match_start', (d: unknown) => listener('match_start', d));
    socket.on('match_end', (d: unknown) => listener('match_end', d));
    socket.on('goal', (d: unknown) => listener('goal', d));
    socket.on('card', (d: unknown) => listener('card', d));
    socket.on('substitution', (d: unknown) => listener('substitution', d));

    socket.emit('join', room);

    return () => {
      socket.emit('leave', room);
      socket.close();
    };
  }
}

/** Minimal structural type for socket.io-client — avoids pulling the types package. */
interface SocketHandle {
  on(event: string, handler: (data: unknown) => void): void;
  emit(event: string, payload: unknown): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Sub-APIs
// ---------------------------------------------------------------------------

class MatchesApi {
  constructor(private readonly client: BigBallSportsClient) {}

  list(params: MatchListParams): Promise<ApiResponse<Match[]>> {
    return this.client.get<Match[]>('/v1/matches', { ...params });
  }

  get(id: string, fields?: FieldKey[], sport?: SportType): Promise<ApiResponse<Match>> {
    return this.client.get<Match>(`/v1/matches/${encodeURIComponent(id)}`, {
      sport: sport ?? 'football',
      ...(fields && fields.length > 0 ? { fields } : {}),
    });
  }

  odds(id: string, sport?: SportType): Promise<ApiResponse<OddsLine[]>> {
    return this.client.get<OddsLine[]>(`/v1/matches/${encodeURIComponent(id)}/odds`, {
      sport: sport ?? 'football',
    });
  }

  events(id: string, sport?: SportType): Promise<ApiResponse<MatchEvent[]>> {
    return this.client.get<MatchEvent[]>(`/v1/matches/${encodeURIComponent(id)}/events`, {
      sport: sport ?? 'football',
    });
  }
}

class PlayersApi {
  constructor(private readonly client: BigBallSportsClient) {}

  get(id: string, sport: SportType): Promise<ApiResponse<Player>> {
    return this.client.get<Player>(`/v1/players/${encodeURIComponent(id)}`, { sport });
  }

  stats(id: string, params: StatsParams): Promise<ApiResponse<PlayerStats[]>> {
    return this.client.get<PlayerStats[]>(`/v1/players/${encodeURIComponent(id)}/stats`, {
      ...params,
    });
  }
}

class StandingsApi {
  constructor(private readonly client: BigBallSportsClient) {}

  get(
    league: string,
    season?: number,
    sport: SportType = 'football',
  ): Promise<ApiResponse<Standing[]>> {
    return this.client.get<Standing[]>('/v1/standings', {
      sport,
      leagueId: league,
      ...(season !== undefined ? { season: String(season) } : {}),
    });
  }
}

class InjuriesApi {
  constructor(private readonly client: BigBallSportsClient) {}

  list(params: InjuryParams): Promise<ApiResponse<Injury[]>> {
    return this.client.get<Injury[]>('/v1/injuries', { ...params });
  }
}

class CricketApi {
  constructor(private readonly client: BigBallSportsClient) {}

  matches(series?: string): Promise<ApiResponse<Match[]>> {
    return this.client.get<Match[]>('/v1/cricket/matches', {
      ...(series !== undefined ? { series } : {}),
    });
  }

  scorecard(matchId: string): Promise<ApiResponse<unknown>> {
    return this.client.get<unknown>(
      `/v1/cricket/matches/${encodeURIComponent(matchId)}/scorecard`,
    );
  }
}

class CombatApi {
  constructor(private readonly client: BigBallSportsClient) {}

  cards(sport: 'mma' | 'boxing' = 'mma', date?: string): Promise<ApiResponse<unknown>> {
    return this.client.get<unknown>('/v1/fight-cards', {
      sport,
      ...(date !== undefined ? { date } : {}),
    });
  }

  bout(id: string, sport: 'mma' | 'boxing' = 'mma'): Promise<ApiResponse<unknown>> {
    return this.client.get<unknown>(`/v1/bouts/${encodeURIComponent(id)}`, { sport });
  }

  athlete(id: string, sport: 'mma' | 'boxing' = 'mma'): Promise<ApiResponse<unknown>> {
    return this.client.get<unknown>(`/v1/athletes/${encodeURIComponent(id)}`, { sport });
  }
}

export { HttpError };
