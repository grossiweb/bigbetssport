// ---------------------------------------------------------------------------
// Canonical type definitions for Big Ball Sports.
// This file is the single source of truth for data shapes across the platform.
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

export type PriorityTier = 'P0' | 'P1' | 'P2';

export type FetchVia = 'api' | 'cache' | 'mcp';

export type SourceTier = 1 | 2;

export interface SourceConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly authHeader: string;
  readonly envKey: string;
  readonly dailyCap: number;
  readonly perMinuteCap: number;
  readonly hasDelta: boolean;
  readonly hasIncludes: boolean;
  readonly maxPageSize: number;
  readonly sports: readonly SportType[];
  readonly tier: SourceTier;
}

export interface FetchParams {
  readonly sport: SportType;
  readonly matchId?: string;
  readonly teamId?: string;
  readonly playerId?: string;
  readonly date?: string;
  readonly season?: string;
  readonly leagueId?: string;
}

export interface FieldResult {
  readonly value: unknown;
  readonly source: string;
  readonly via: FetchVia;
  readonly confidence: number;
  readonly fetchedAt: string;
  readonly ttlSeconds: number;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ResponseMeta {
  readonly source: string;
  readonly confidence: number;
  readonly cached: boolean;
  readonly cache_age_ms: number;
  readonly request_id: string;
  readonly fields_missing?: readonly string[];
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
  readonly error: ApiError | null;
}

export interface McpScraper {
  readonly id: string;
  readonly name: string;
  readonly mcpServerUrl: string;
  readonly coveredFields: readonly FieldKey[];
  readonly coveredSports: readonly SportType[];
  readonly rateLimit: number;
  readonly tool: string;
}

// ---------------------------------------------------------------------------
// Useful read-only constant lists. Consumers should prefer these over string
// literals so extending the platform is a single-file edit.
// ---------------------------------------------------------------------------

export const ALL_FIELD_KEYS: readonly FieldKey[] = [
  'scores',
  'odds',
  'lineups',
  'players',
  'stats',
  'historical',
  'injuries',
  'xg',
  'transfers',
  'standings',
] as const;

export const ALL_SPORTS: readonly SportType[] = [
  'football',
  'basketball',
  'baseball',
  'ice_hockey',
  'cricket',
  'mma',
  'boxing',
  'esports',
  'formula1',
  'american_football',
  'rugby',
] as const;

export const ALL_PRIORITY_TIERS: readonly PriorityTier[] = ['P0', 'P1', 'P2'] as const;
