import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { FieldKey, FetchParams, FieldResult } from '@bbs/shared';
import { gapDetectedTotal, quotaUsedTotal, resetSharedMetrics } from '@bbs/shared';
import { FieldCache } from './cache.js';
import { FieldRouter } from './field-router.js';
import { RateLimitOrchestrator } from './orchestrator.js';
import { GapDetector } from './gap-detector.js';
import type { SourceAdapter } from './sources/adapter.js';
import { FIELD_REGISTRY } from './field-registry.js';

// ---------------------------------------------------------------------------
// Test-only adapter that hits a predictable URL so MSW handlers can mock it.
// ---------------------------------------------------------------------------

function makeTestAdapter(sourceId: string, url: string, value: unknown): SourceAdapter {
  return {
    sourceId,
    confidence: 0.9,
    buildRequest(_field, _params) {
      return new Request(url);
    },
    extractField(_field, data) {
      if (data === null || typeof data !== 'object') return null;
      const d = data as Record<string, unknown>;
      return d['value'] ?? value;
    },
  };
}

// Shape FIELD_REGISTRY override so the scores walk is predictable. We use
// two football-supporting sources so both pass the sports.includes() filter
// in the router.
const TEST_REGISTRY: typeof FIELD_REGISTRY = {
  ...FIELD_REGISTRY,
  scores: {
    ttlSeconds: 30,
    sources: ['api-sports', 'football-data'],
    mcpFallback: [],
  },
};

const PRIMARY_URL = 'https://primary.test/scores';
const FALLBACK_URL = 'https://fallback.test/scores';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('FieldRouter.fetchField', () => {
  let redis: Redis;
  let cache: FieldCache;
  let orchestrator: RateLimitOrchestrator;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    cache = new FieldCache(redis);
    orchestrator = new RateLimitOrchestrator({ redis });
    resetSharedMetrics();
  });

  afterEach(async () => {
    await orchestrator.close();
    await redis.quit();
  });

  it('cache hit returns without upstream call', async () => {
    const cached: FieldResult = {
      value: { from: 'cache' },
      source: 'api-sports',
      via: 'cache',
      confidence: 1,
      fetchedAt: new Date().toISOString(),
      ttlSeconds: 30,
    };
    const params: FetchParams = { sport: 'football' };
    await cache.set(cached, 'scores', params);

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, { from: 'upstream' })],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await router.fetchField('scores', params);

    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ from: 'cache' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('falls through to next source when the first 500s', async () => {
    server.use(
      http.get(PRIMARY_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(FALLBACK_URL, () => HttpResponse.json({ value: { from: 'mlb' } })),
    );

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, null)],
      ['football-data', makeTestAdapter('football-data', FALLBACK_URL, { from: 'mlb' })],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
    });

    const result = await router.fetchField('scores', { sport: 'football' });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('football-data');
    expect(result!.value).toEqual({ from: 'mlb' });
  });

  it('falls through to next source when the first 429s (rate limited)', async () => {
    server.use(
      http.get(PRIMARY_URL, () => new HttpResponse(null, { status: 429 })),
      http.get(FALLBACK_URL, () => HttpResponse.json({ value: { from: 'mlb' } })),
    );

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, null)],
      ['football-data', makeTestAdapter('football-data', FALLBACK_URL, { from: 'mlb' })],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
    });

    const result = await router.fetchField('scores', { sport: 'football' });
    expect(result!.source).toBe('football-data');
  });

  it('returns null when all sources exhausted and no gap detector', async () => {
    server.use(
      http.get(PRIMARY_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(FALLBACK_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, null)],
      ['football-data', makeTestAdapter('football-data', FALLBACK_URL, null)],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
    });

    const result = await router.fetchField('scores', { sport: 'football' });
    expect(result).toBeNull();
  });

  it('delegates to gap detector when all sources exhausted', async () => {
    server.use(
      http.get(PRIMARY_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(FALLBACK_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const gapDetector = new GapDetector(redis, []);
    const spy = vi.spyOn(gapDetector, 'triggerGapFill').mockResolvedValue({
      value: { from: 'mcp' },
      source: 'mcp-sofascore',
      via: 'mcp',
      confidence: 0.6,
      fetchedAt: new Date().toISOString(),
      ttlSeconds: 300,
    } as FieldResult);

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, null)],
      ['football-data', makeTestAdapter('football-data', FALLBACK_URL, null)],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
      gapDetector,
    });

    const result = await router.fetchField('scores', { sport: 'football' });
    expect(result).not.toBeNull();
    expect(result!.via).toBe('mcp');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('caches the successful result so subsequent calls skip upstream', async () => {
    let nhlCalls = 0;
    server.use(
      http.get(PRIMARY_URL, () => {
        nhlCalls += 1;
        return HttpResponse.json({ value: { ok: true } });
      }),
    );

    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, { ok: true })],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: {
        ...TEST_REGISTRY,
        scores: { ttlSeconds: 30, sources: ['api-sports'], mcpFallback: [] },
      },
    });

    const params: FetchParams = { sport: 'football' };
    await router.fetchField('scores', params);
    await router.fetchField('scores', params);

    expect(nhlCalls).toBe(1);
  });

  // --- P-09 metric wiring ------------------------------------------------

  it('increments bbs_quota_used_total when a fetch consumes quota', async () => {
    server.use(
      http.get(PRIMARY_URL, () => HttpResponse.json({ value: { ok: true } })),
    );
    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, { ok: true })],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: {
        ...TEST_REGISTRY,
        scores: { ttlSeconds: 30, sources: ['api-sports'], mcpFallback: [] },
      },
    });

    await router.fetchField('scores', { sport: 'football' });
    const metric = await quotaUsedTotal.get();
    const match = metric.values.find(
      (v) => v.labels['source_id'] === 'api-sports' && v.labels['field'] === 'scores',
    );
    expect(match?.value).toBeGreaterThanOrEqual(1);
  });

  it('increments bbs_gap_detected_total when all upstreams return null', async () => {
    server.use(
      http.get(PRIMARY_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(FALLBACK_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const adapters = new Map<string, SourceAdapter>([
      ['api-sports', makeTestAdapter('api-sports', PRIMARY_URL, null)],
      ['football-data', makeTestAdapter('football-data', FALLBACK_URL, null)],
    ]);
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters,
      registry: TEST_REGISTRY,
    });

    await router.fetchField('scores', { sport: 'football' });

    const metric = await gapDetectedTotal.get();
    const match = metric.values.find(
      (v) => v.labels['field'] === 'scores' && v.labels['sport'] === 'football',
    );
    expect(match?.value).toBeGreaterThanOrEqual(1);
  });
});

describe('FieldRouter.fetchMatch', () => {
  let redis: Redis;
  let cache: FieldCache;
  let orchestrator: RateLimitOrchestrator;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    cache = new FieldCache(redis);
    orchestrator = new RateLimitOrchestrator({ redis });
  });

  afterEach(async () => {
    await orchestrator.close();
    await redis.quit();
  });

  it('returns a field-keyed record with one entry per requested field', async () => {
    const fields: FieldKey[] = ['scores', 'standings'];
    const router = new FieldRouter({
      cache,
      orchestrator,
      adapters: new Map(),
      registry: TEST_REGISTRY,
    });
    const result = await router.fetchMatch('m1', 'football', fields);
    expect(Object.keys(result).sort()).toEqual(['scores', 'standings']);
    expect(result.scores).toBeNull();
    expect(result.standings).toBeNull();
  });
});
