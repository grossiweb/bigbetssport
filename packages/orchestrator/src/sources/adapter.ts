import type { FetchParams, FieldKey } from '@bbs/shared';

/**
 * Contract for a source adapter.
 *
 * The field router uses this in two phases:
 *
 *   1. `buildRequest(field, params)` — compose the exact upstream HTTP
 *      Request. Return `null` if this source doesn't cover the requested
 *      (field, sport, params) combination — the router will skip without
 *      consuming quota or queue capacity.
 *
 *   2. `extractField(field, data)` — pull the relevant chunk of the response
 *      JSON. Return `null` if the response is structurally valid but the
 *      field isn't present (empty match list, unknown player, etc.).
 *
 * Adapters are stateless — they read no Redis, hold no connections.
 */
export interface SourceAdapter {
  readonly sourceId: string;

  /** Confidence score used when scoring fetched values. 0 ≤ x ≤ 1. */
  readonly confidence: number;

  buildRequest(field: FieldKey, params: FetchParams): Request | null;

  extractField(field: FieldKey, data: unknown): unknown | null;
}

/**
 * Thrown when an adapter is missing for a source id the router was told to
 * call. Treated as a permanent failure — no breaker penalty, no retry.
 */
export class NoAdapterError extends Error {
  constructor(sourceId: string) {
    super(`no adapter registered for source: ${sourceId}`);
    this.name = 'NoAdapterError';
  }
}

/**
 * Thrown from adapter helpers when required params are missing.
 */
export class AdapterRequirementError extends Error {
  constructor(sourceId: string, message: string) {
    super(`adapter ${sourceId}: ${message}`);
    this.name = 'AdapterRequirementError';
  }
}
