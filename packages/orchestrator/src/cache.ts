import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_KEYS } from '@bbs/shared';
import type { FetchParams, FieldKey, FieldResult } from '@bbs/shared';

/**
 * Field cache — stores `FieldResult` JSON keyed by a stable hash of
 * `(field, FetchParams)`. TTLs come from the caller (the field router reads
 * `FIELD_REGISTRY[field].ttlSeconds`).
 *
 * Special cases:
 *   - `result.ttlSeconds === 0` → PERSIST (no expiry). Used for historical
 *     data that will never change.
 *   - Any Redis error on get/set is treated as a cache miss; the field
 *     router falls through to the upstream path rather than failing the
 *     entire request.
 *
 * Secondary index: when a result's params contain a `matchId`, the cache
 * key is added to `match:{matchId}:cache_keys` (SET). `invalidateByMatch`
 * uses this to purge all per-match entries in one call.
 */

const MATCH_KEYS_PREFIX = 'match:';
const MATCH_KEYS_SUFFIX = ':cache_keys';

function matchIndexKey(matchId: string): string {
  return `${MATCH_KEYS_PREFIX}${matchId}${MATCH_KEYS_SUFFIX}`;
}

/**
 * Stable stringify — sorts keys alphabetically and drops `undefined`
 * values. Needed so `{ sport: 'football', date: '2026-04-17' }` and
 * `{ date: '2026-04-17', sport: 'football' }` hash to the same cache key.
 */
export function stableStringify(params: FetchParams): string {
  const src = params as unknown as Record<string, unknown>;
  const keys = Object.keys(src).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined) canonical[k] = v;
  }
  return JSON.stringify(canonical);
}

function cacheKey(field: FieldKey, params: FetchParams): string {
  const hash = createHash('sha256').update(stableStringify(params)).digest('hex');
  return REDIS_KEYS.fieldCache(field, { ...params, __hash: hash } as FetchParams);
}

function isFieldResult(v: unknown): v is FieldResult {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['source'] === 'string' &&
    typeof o['via'] === 'string' &&
    typeof o['confidence'] === 'number' &&
    typeof o['fetchedAt'] === 'string' &&
    typeof o['ttlSeconds'] === 'number' &&
    'value' in o
  );
}

export class FieldCache {
  constructor(private readonly redis: Redis) {}

  async get(field: FieldKey, params: FetchParams): Promise<FieldResult | null> {
    const key = cacheKey(field, params);
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      return isFieldResult(parsed) ? parsed : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cache:get] ${msg}`);
      return null;
    }
  }

  /**
   * Store `result`. Respects `result.ttlSeconds`:
   *   > 0 → SET with EX.
   *     0 → SET PERSIST (no expiry); used for immutable historical data.
   *
   * `params` are passed separately (not on result) so the cache key shape
   * stays consistent with `get`.
   */
  async set(result: FieldResult, field: FieldKey, params: FetchParams): Promise<void> {
    const key = cacheKey(field, params);
    try {
      if (result.ttlSeconds > 0) {
        await this.redis.set(key, JSON.stringify(result), 'EX', Math.floor(result.ttlSeconds));
      } else {
        await this.redis.set(key, JSON.stringify(result));
      }
      if (params.matchId) {
        await this.redis.sadd(matchIndexKey(params.matchId), key);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cache:set] ${msg}`);
    }
  }

  /**
   * Delete a single (field, params) entry.
   */
  async invalidate(field: FieldKey, params: FetchParams): Promise<void> {
    const key = cacheKey(field, params);
    try {
      await this.redis.del(key);
      if (params.matchId) {
        await this.redis.srem(matchIndexKey(params.matchId), key);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cache:invalidate] ${msg}`);
    }
  }

  /**
   * Purge every cache entry we've stored for a given match. Used when an
   * upstream tells us match state has changed (delta updates etc).
   */
  async invalidateByMatch(matchId: string): Promise<number> {
    const indexKey = matchIndexKey(matchId);
    try {
      const keys = await this.redis.smembers(indexKey);
      if (keys.length === 0) return 0;
      await this.redis.del(...keys, indexKey);
      return keys.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cache:invalidateByMatch] ${msg}`);
      return 0;
    }
  }
}
