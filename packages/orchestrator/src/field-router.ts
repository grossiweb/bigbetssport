import type { FetchParams, FieldKey, FieldResult, SportType } from '@bbs/shared';
import {
  cacheHitTotal,
  cacheMissTotal,
  childLogger,
  fieldFetchDuration,
  gapDetectedTotal,
  quotaUsedTotal,
} from '@bbs/shared';
import type { FieldCache } from './cache.js';
import { FIELD_REGISTRY } from './field-registry.js';
import type { RateLimitOrchestrator } from './orchestrator.js';
import { tierForField } from './priority-queue.js';
import type { SourceAdapter } from './sources/adapter.js';
import { getSource } from './sources/registry.js';
import type { GapDetector } from './gap-detector.js';
import {
  cacheHitsTotal,
  cacheMissesTotal,
  cbSkipsTotal,
  jobsEnqueuedTotal,
  quotaRejectsTotal,
  requestsTotal,
  unavailableTotal,
} from './metrics.js';

const routerLog = childLogger({ component: 'field-router' });

/**
 * Synchronous, per-request field router.
 *
 *   1. Cache hit → return.
 *   2. For each source in FIELD_REGISTRY[field].sources:
 *        canFire → skip on quota/breaker/suspension
 *        buildRequest → skip on null
 *        inject auth header from SourceConfig
 *        fetch with 10s timeout
 *        429 → orchestrator.failed; try next
 *        non-2xx → orchestrator.failed; try next
 *        extractField null → try next
 *        succeeded → cache → return
 *   3. No source produced data → delegate to GapDetector (MCP fallback).
 */

const FETCH_TIMEOUT_MS = 10_000;

export interface FieldRouterOptions {
  readonly cache: FieldCache;
  readonly orchestrator: RateLimitOrchestrator;
  readonly adapters: Map<string, SourceAdapter>;
  readonly registry?: typeof FIELD_REGISTRY;
  readonly gapDetector?: GapDetector;
  readonly fetchTimeoutMs?: number;
}

export class FieldRouter {
  private readonly cache: FieldCache;
  private readonly orchestrator: RateLimitOrchestrator;
  private readonly adapters: Map<string, SourceAdapter>;
  private readonly registry: typeof FIELD_REGISTRY;
  private readonly gapDetector?: GapDetector;
  private readonly fetchTimeoutMs: number;

  constructor(opts: FieldRouterOptions) {
    this.cache = opts.cache;
    this.orchestrator = opts.orchestrator;
    this.adapters = opts.adapters;
    this.registry = opts.registry ?? FIELD_REGISTRY;
    this.gapDetector = opts.gapDetector;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  }

  async fetchField(
    field: FieldKey,
    params: FetchParams,
  ): Promise<FieldResult | null> {
    requestsTotal.inc({ field, sport: params.sport });

    const cached = await this.cache.get(field, params);
    if (cached !== null) {
      cacheHitsTotal.inc({ field });
      cacheHitTotal.inc({ field });
      routerLog.debug(
        { field, sport: params.sport, ttlRemaining: cached.ttlSeconds },
        'cache hit',
      );
      return cached;
    }
    cacheMissesTotal.inc({ field });
    cacheMissTotal.inc({ field });
    routerLog.debug({ field, sport: params.sport }, 'cache miss');

    const entry = this.registry[field];
    const tier = tierForField(field);

    for (const sourceId of entry.sources) {
      const sourceConfig = getSource(sourceId);
      if (!sourceConfig) continue;
      if (!sourceConfig.sports.includes(params.sport)) continue;

      const adapter = this.adapters.get(sourceId);
      if (!adapter) continue;

      const decision = await this.orchestrator.canFire(sourceId, tier);
      if (!decision.fire) {
        if (decision.reason === 'circuit') cbSkipsTotal.inc({ source: sourceId });
        else if (decision.reason === 'quota')
          quotaRejectsTotal.inc({ source: sourceId, reason: 'blocked' });
        continue;
      }

      // Quota was already atomically deducted inside canFire — this counter
      // mirrors the consume, labelled with the field so dashboards can see
      // which endpoint is burning the budget.
      quotaUsedTotal.inc({ source_id: sourceId, field });

      const baseReq = adapter.buildRequest(field, params);
      if (!baseReq) continue;

      // Inject auth header from SourceConfig if not already set by the adapter.
      const request = injectAuthHeader(baseReq, sourceConfig.authHeader, sourceConfig.envKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
      const startedAt = performance.now();

      let response: Response | null = null;
      try {
        response = await fetch(request, { signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        const latencyMs = performance.now() - startedAt;
        const msg = err instanceof Error ? err.message : String(err);
        routerLog.error({ sourceId, field, sport: params.sport, latencyMs, err: msg }, 'upstream fetch failed');
        fieldFetchDuration.observe({ source_id: sourceId, field, via: 'api' }, latencyMs);
        await this.orchestrator.failed(sourceId, 0);
        continue;
      }
      clearTimeout(timer);
      const latencyMs = performance.now() - startedAt;
      fieldFetchDuration.observe({ source_id: sourceId, field, via: 'api' }, latencyMs);
      routerLog.info(
        { sourceId, field, sport: params.sport, latencyMs, status: response.status },
        'upstream call',
      );

      if (response.status === 429) {
        await this.orchestrator.failed(sourceId, 429);
        continue;
      }
      if (!response.ok) {
        await this.orchestrator.failed(sourceId, response.status);
        continue;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        await this.orchestrator.failed(sourceId, response.status);
        continue;
      }

      const value = adapter.extractField(field, data);
      if (value === null) {
        // Source returned 200 but didn't have the field — don't penalise it
        // (it's not a failure, just a miss). Just try the next candidate.
        continue;
      }

      await this.orchestrator.succeeded(sourceId);
      jobsEnqueuedTotal.inc({ queue: `tier:${tier}`, field, source: sourceId });

      const result: FieldResult = {
        value,
        source: sourceId,
        via: 'api',
        confidence: adapter.confidence,
        fetchedAt: new Date().toISOString(),
        ttlSeconds: entry.ttlSeconds,
      };
      await this.cache.set(result, field, params);
      return result;
    }

    // Gap fill — MCP scraper as last resort.
    if (this.gapDetector) {
      gapDetectedTotal.inc({ field, sport: params.sport });
      routerLog.warn(
        { field, sport: params.sport, sourcesExhausted: entry.sources.length },
        'gap event: all upstream sources exhausted, delegating to MCP',
      );
      const mcpResult = await this.gapDetector.triggerGapFill(field, params);
      if (mcpResult !== null) {
        await this.cache.set(mcpResult, field, params);
        return mcpResult;
      }
    } else {
      gapDetectedTotal.inc({ field, sport: params.sport });
      routerLog.warn(
        { field, sport: params.sport, sourcesExhausted: entry.sources.length },
        'gap event: no gap detector configured',
      );
    }

    unavailableTotal.inc({ field, sport: params.sport });
    return null;
  }

  /**
   * Fetch multiple fields for one match in parallel. Keys that aren't
   * satisfiable land as `null` in the returned record.
   */
  async fetchMatch(
    matchId: string,
    sport: SportType,
    fields: readonly FieldKey[],
  ): Promise<Record<FieldKey, FieldResult | null>> {
    const params: FetchParams = { sport, matchId };
    const results = await Promise.all(
      fields.map(async (f) => [f, await this.fetchField(f, params)] as const),
    );
    const out: Partial<Record<FieldKey, FieldResult | null>> = {};
    for (const [field, result] of results) out[field] = result;
    return out as Record<FieldKey, FieldResult | null>;
  }

  getAdapters(): ReadonlyMap<string, SourceAdapter> {
    return this.adapters;
  }
}

function injectAuthHeader(request: Request, headerName: string, envKey: string): Request {
  if (!headerName || !envKey) return request;
  const token = process.env[envKey];
  if (!token) return request;
  if (request.headers.has(headerName)) return request;
  const headers = new Headers(request.headers);
  headers.set(headerName, token);
  return new Request(request, { headers });
}
