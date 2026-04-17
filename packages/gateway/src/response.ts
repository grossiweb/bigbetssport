import type {
  ApiError,
  ApiResponse,
  FieldKey,
  FieldResult,
  ResponseMeta,
} from '@bbs/shared';
import { fieldsMissingTotal, fieldsReturnedTotal } from './metrics.js';

/**
 * Data payload shape for multi-field requests. Keyed by `FieldKey`, each
 * value is a `FieldResult` on success or null when the field could not be
 * satisfied by any source (tried upstreams + MCP fallback).
 */
export type FieldMap = Partial<Record<FieldKey, FieldResult | null>>;

/**
 * Build the canonical `ApiResponse<FieldMap>` from a map of per-field
 * `FieldResult | null` outcomes. Decides the HTTP status:
 *
 *   all fields returned         → 200
 *   some returned + some null   → 200 (partial; fields_missing populated)
 *   all null                    → 503 (upstream_unavailable)
 *   empty input                 → 400 (caller should reject upstream)
 */
export function buildMultiFieldResponse(
  outcomes: ReadonlyMap<FieldKey, FieldResult | null>,
  requestId: string,
): { readonly status: number; readonly body: ApiResponse<FieldMap> } {
  const data: FieldMap = {};
  const missing: FieldKey[] = [];
  const sourcesSeen = new Set<string>();
  let totalConfidence = 0;
  let hitCount = 0;
  let cacheAgeMs = 0;
  let sawNonCached = false;

  for (const [field, result] of outcomes) {
    if (result === null) {
      data[field] = null;
      missing.push(field);
      fieldsMissingTotal.inc({ field, reason: 'unavailable' });
      continue;
    }
    data[field] = result;
    sourcesSeen.add(result.source);
    totalConfidence += result.confidence;
    hitCount += 1;
    fieldsReturnedTotal.inc({ field, via: result.via });

    // `cached` in meta is true only when every returned field came from
    // cache; one api/mcp result flips the flag.
    if (result.via !== 'cache') sawNonCached = true;

    const ageMs = Date.now() - Date.parse(result.fetchedAt);
    if (Number.isFinite(ageMs) && ageMs > cacheAgeMs) cacheAgeMs = ageMs;
  }

  const totalFields = outcomes.size;
  const avgConfidence = hitCount > 0 ? totalConfidence / hitCount : 0;

  let source: string;
  if (sourcesSeen.size === 0) source = 'none';
  else if (sourcesSeen.size === 1) source = [...sourcesSeen][0] ?? 'unknown';
  else source = 'mixed';

  const meta: ResponseMeta = {
    source,
    confidence: Number(avgConfidence.toFixed(2)),
    cached: hitCount > 0 && !sawNonCached,
    cache_age_ms: cacheAgeMs,
    request_id: requestId,
    ...(missing.length > 0 ? { fields_missing: missing } : {}),
  };

  let error: ApiError | null = null;
  let status: number;

  if (totalFields === 0) {
    status = 400;
    error = { code: 'bad_request', message: 'no fields requested' };
  } else if (hitCount === 0) {
    status = 503;
    error = {
      code: 'upstream_unavailable',
      message: 'no source could satisfy any requested field',
    };
  } else {
    status = 200;
  }

  return {
    status,
    body: { data, meta, error },
  };
}

/**
 * Build an error envelope without any data. Used for validation errors,
 * auth failures, unhandled exceptions, etc.
 */
export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ApiResponse<null> {
  const meta: ResponseMeta = {
    source: 'none',
    confidence: 0,
    cached: false,
    cache_age_ms: 0,
    request_id: requestId,
  };
  const error: ApiError = details === undefined ? { code, message } : { code, message, details };
  return { data: null, meta, error };
}
