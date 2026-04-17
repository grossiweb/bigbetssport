import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import type { FieldKey, FetchParams } from './types.js';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

function resolveUrl(url: string | undefined): string {
  if (url && url.length > 0) return url;
  const envUrl = process.env['REDIS_URL'];
  if (envUrl && envUrl.length > 0) return envUrl;
  return DEFAULT_REDIS_URL;
}

function attachErrorHandler(client: Redis, label: string): void {
  // ioredis auto-reconnects. We log but never throw; unhandled errors on the
  // client would otherwise crash the process.
  client.on('error', (err: Error) => {
    console.error(`[redis:${label}] ${err.message}`);
  });
}

/**
 * Create a new ioredis client. If no `url` is passed, falls back to the
 * `REDIS_URL` env var, then to `redis://localhost:6379`.
 */
export function createRedisClient(url?: string): Redis {
  const client = new Redis(resolveUrl(url), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  attachErrorHandler(client, 'client');
  return client;
}

/**
 * Create a pub/sub pair. Redis subscribers enter a blocking mode and cannot
 * issue normal commands, so pub and sub must be separate connections.
 */
export function createRedisPubSub(url?: string): { pub: Redis; sub: Redis } {
  const resolved = resolveUrl(url);
  const pub = new Redis(resolved, { maxRetriesPerRequest: null });
  const sub = new Redis(resolved, { maxRetriesPerRequest: null });
  attachErrorHandler(pub, 'pub');
  attachErrorHandler(sub, 'sub');
  return { pub, sub };
}

// ---------------------------------------------------------------------------
// Redis key conventions.
// Using a single frozen helper object keeps key shapes consistent across the
// codebase and avoids stringly-typed duplication.
// ---------------------------------------------------------------------------

function canonicalStringify(params: FetchParams): string {
  // Sort keys so logically-equal param objects hash identically regardless of
  // property-declaration order. Undefined values are elided.
  const source = params as unknown as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined) canonical[k] = v;
  }
  return JSON.stringify(canonical);
}

function hashParams(params: FetchParams): string {
  return createHash('sha256').update(canonicalStringify(params)).digest('hex');
}

export const REDIS_KEYS = Object.freeze({
  quotaDay: (sourceId: string): string => `quota:${sourceId}:day`,
  quotaMin: (sourceId: string): string => `quota:${sourceId}:min`,
  cb: (sourceId: string): string => `cb:${sourceId}`,
  cbFails: (sourceId: string): string => `cb:${sourceId}:fails`,
  deltaCursor: (sportId: string): string => `delta:cursor:${sportId}`,
  liveWindow: (sportId: string): string => `liveWindow:${sportId}`,
  fieldCache: (field: FieldKey, params: FetchParams): string =>
    `cache:${field}:${hashParams(params)}`,
  eventChannel: (sportId: string): string => `bbs:updates:${sportId}`,
});

export type RedisKeys = typeof REDIS_KEYS;
