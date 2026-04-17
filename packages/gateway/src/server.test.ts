import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { FetchParams, FieldKey, FieldResult } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';
import { buildServer } from './server.js';
import { EnvKeyStore } from './key-store.js';
import { WebhookStore } from './webhooks/store.js';
import { WebhookDelivery, sign } from './webhooks/delivery.js';
import { RateLimitOrchestrator } from '@bbs/orchestrator';

/**
 * Integration suite covering the six P-07 spec assertions.
 *
 * We bypass the heavyweight GraphQL + OpenAPI plugins (`withoutGraphql`,
 * `withoutOpenApi`) to keep startup fast; they're tested separately.
 */

const VALID_KEY = 'test-key-free';
const STARTER_KEY = 'test-key-starter';

function makeRouterStub(
  respond: (field: FieldKey, params: FetchParams) => FieldResult | null,
): FieldRouter {
  return {
    fetchField: vi.fn(async (field: FieldKey, params: FetchParams) => respond(field, params)),
    fetchMatch: vi.fn(async () => ({})),
    getAdapters: vi.fn(() => new Map()),
  } as unknown as FieldRouter;
}

function hit(field: FieldKey): FieldResult {
  return {
    value: { field },
    source: 'test-source',
    via: 'api',
    confidence: 0.9,
    fetchedAt: new Date().toISOString(),
    ttlSeconds: 60,
  };
}

function buildKeyStore(): EnvKeyStore {
  const store = new EnvKeyStore(undefined);
  store.put(VALID_KEY, 'free');
  store.put(STARTER_KEY, 'starter');
  return store;
}

async function makeServer(
  redis: Redis,
  router: FieldRouter = makeRouterStub(() => null),
): Promise<FastifyInstance> {
  return buildServer({
    redis,
    router,
    keyStore: buildKeyStore(),
    withoutGraphql: true,
    withoutOpenApi: true,
  });
}

describe('gateway P-07 integration', () => {
  let redis: Redis;
  let app: FastifyInstance;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
  });

  afterEach(async () => {
    await app?.close();
    await redis.quit();
  });

  it('GET /v1/matches/:id without auth → 401', async () => {
    app = await makeServer(redis);
    const res = await app.inject({ method: 'GET', url: '/v1/matches/m1?sport=football' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('GET /v1/matches/:id with valid key → 200 with envelope', async () => {
    app = await makeServer(
      redis,
      makeRouterStub((field) => hit(field)),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/matches/m1?sport=football&fields=scores',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Record<string, unknown>;
      meta: { request_id: string; source: string };
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.meta.request_id).toBeTruthy();
    expect(body.data['scores']).not.toBeNull();
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-ratelimit-limit']).toBe('100');
  });

  it('GET /v1/matches/:id?fields=scores,odds → both fields resolved', async () => {
    app = await makeServer(
      redis,
      makeRouterStub((field) => hit(field)),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/matches/m1?sport=football&fields=scores,odds',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; meta: { fields_missing?: string[] } };
    expect(body.data['scores']).not.toBeNull();
    expect(body.data['odds']).not.toBeNull();
    expect(body.meta.fields_missing).toBeUndefined();
  });

  it('GET /v1/matches/:id?fields=xg → xg null on unresolved upstream, fields_missing populated', async () => {
    app = await makeServer(
      redis,
      makeRouterStub((field) => (field === 'xg' ? null : hit(field))),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/matches/m1?sport=football&fields=xg',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { data: Record<string, unknown>; meta: { fields_missing?: string[] } };
    expect(body.data['xg']).toBeNull();
    expect(body.meta.fields_missing).toEqual(['xg']);
  });

  it('POST /v1/webhooks → registered, next event delivered with valid HMAC signature', async () => {
    app = await makeServer(redis);

    const register = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': VALID_KEY, 'content-type': 'application/json' },
      payload: { url: 'https://example.test/hook', events: ['score_update'] },
    });
    expect(register.statusCode).toBe(201);
    const registered = register.json() as { data: { id: string; secret: string } };
    expect(registered.data.id).toBeTruthy();
    expect(registered.data.secret).toBeTruthy();

    // Now simulate event delivery.
    const store = new WebhookStore(redis);
    const sentBodies: string[] = [];
    const sentHeaders: Record<string, string>[] = [];
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBodies.push(typeof init?.body === 'string' ? init.body : '');
      sentHeaders.push((init?.headers as Record<string, string>) ?? {});
      return new Response(null, { status: 200 });
    });
    const delivery = new WebhookDelivery(store, async () => {}, fakeFetch as unknown as typeof fetch);

    const attempts = await delivery.deliver({
      id: 'evt-1',
      type: 'score_update',
      occurredAt: new Date().toISOString(),
      payload: { matchId: 'm1', score: '1-0' },
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    const body = sentBodies[0] ?? '';
    const signature = sentHeaders[0]?.['x-bbs-signature'] ?? '';
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signature).toBe(sign(body, registered.data.secret));
  });

  // --- P-08 cricket + combat integration -------------------------------

  it('GET /v1/cricket/matches with valid key returns 200 + envelope', async () => {
    app = await makeServer(
      redis,
      makeRouterStub((field) => (field === 'scores' ? hit(field) : null)),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cricket/matches',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Record<string, unknown>;
      meta: { request_id: string };
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data['scores']).not.toBeNull();
    expect(body.meta.request_id).toBeTruthy();
  });

  it('GET /v1/fight-cards returns bouts sorted by bout_order ASC', async () => {
    const unsorted = [
      { bout_order: 3, fighter_a: 'C', fighter_b: 'D' },
      { bout_order: 1, fighter_a: 'A', fighter_b: 'B' },
      { bout_order: 2, fighter_a: 'E', fighter_b: 'F' },
    ];
    const router = makeRouterStub((field) =>
      field === 'scores'
        ? {
            value: unsorted,
            source: 'mcp-ufc-stats',
            via: 'mcp',
            confidence: 0.6,
            fetchedAt: new Date().toISOString(),
            ttlSeconds: 300,
          }
        : null,
    );
    app = await buildServer({
      redis,
      router,
      keyStore: buildKeyStore(),
      withoutGraphql: true,
      withoutOpenApi: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/fight-cards?sport=mma',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { scores?: { value?: Array<{ bout_order: number }> } };
    };
    const sorted = body.data.scores?.value ?? [];
    expect(sorted.map((b) => b.bout_order)).toEqual([1, 2, 3]);
  });

  it('GET /v1/fight-cards rejects unknown sport', async () => {
    app = await makeServer(redis, makeRouterStub(() => null));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/fight-cards?sport=football',
      headers: { 'x-api-key': VALID_KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate limit: 101st request in 1 minute returns 429', async () => {
    app = await makeServer(
      redis,
      makeRouterStub((field) => hit(field)),
    );
    const hitRoute = (i: number) =>
      app.inject({
        method: 'GET',
        url: `/v1/sports?i=${i}`,
        headers: { 'x-api-key': VALID_KEY },
      });

    for (let i = 0; i < 100; i += 1) {
      const res = await hitRoute(i);
      expect(res.statusCode).toBe(200);
    }
    const blocked = await hitRoute(101);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    const body = blocked.json() as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  // --- P-09 admin + metrics --------------------------------------------

  it('GET /admin/quota without ADMIN_KEY header → 401', async () => {
    process.env['ADMIN_KEY'] = 'secret-admin-token';
    try {
      const rl = new RateLimitOrchestrator({ redis });
      app = await buildServer({
        redis,
        router: makeRouterStub(() => null),
        rateLimiter: rl,
        keyStore: buildKeyStore(),
        withoutGraphql: true,
        withoutOpenApi: true,
      });

      const noKey = await app.inject({ method: 'GET', url: '/admin/quota' });
      expect(noKey.statusCode).toBe(401);

      const withKey = await app.inject({
        method: 'GET',
        url: '/admin/quota',
        headers: { 'x-admin-key': 'secret-admin-token' },
      });
      expect(withKey.statusCode).toBe(200);
      const body = withKey.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);

      await rl.close();
    } finally {
      delete process.env['ADMIN_KEY'];
    }
  });

  it('GET /admin/health returns a HealthReport via admin auth', async () => {
    process.env['ADMIN_KEY'] = 'admin-hc';
    try {
      const rl = new RateLimitOrchestrator({ redis });
      app = await buildServer({
        redis,
        router: makeRouterStub(() => null),
        rateLimiter: rl,
        keyStore: buildKeyStore(),
        withoutGraphql: true,
        withoutOpenApi: true,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { 'x-admin-key': 'admin-hc' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { status: string; sources: Record<string, unknown> } };
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.data.status);
      expect(Object.keys(body.data.sources).length).toBeGreaterThan(0);

      await rl.close();
    } finally {
      delete process.env['ADMIN_KEY'];
    }
  });

  it('/metrics is IP-gated (403 for a forbidden source IP)', async () => {
    process.env['METRICS_ALLOWED_IPS'] = '10.0.0.1';
    try {
      app = await makeServer(redis);
      // fastify.inject() sets `req.ip` to `127.0.0.1` by default — not in the allowlist.
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(403);
    } finally {
      delete process.env['METRICS_ALLOWED_IPS'];
    }
  });

  it('/metrics exposes the merged Prometheus registry when IP is allowed', async () => {
    process.env['METRICS_ALLOWED_IPS'] = '127.0.0.1,*';
    try {
      app = await makeServer(redis);
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      // Gateway-local + shared counters both present.
      expect(res.body).toContain('bbs_gateway_');
      expect(res.body).toContain('bbs_quota_used_total');
    } finally {
      delete process.env['METRICS_ALLOWED_IPS'];
    }
  });
});

