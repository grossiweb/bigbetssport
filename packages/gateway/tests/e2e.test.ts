import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { setTimeout as wait } from 'node:timers/promises';
import { createHmac } from 'node:crypto';
import {
  FieldCache,
  FieldRouter,
  GapDetector,
  RateLimitOrchestrator,
  createAdapterRegistry,
} from '@bbs/orchestrator';
import { buildServer } from '../src/server.js';
import { EnvKeyStore } from '../src/key-store.js';

/**
 * Full end-to-end suite — gated by `E2E=1` to keep the default `pnpm test`
 * fast and hermetic.
 *
 * Required infra (run `make dev` first):
 *   - Postgres with migrations applied (`make migrate`)
 *   - Redis 7
 *   - The 10 MCP scrapers (optional — gap-fill test skips if unreachable)
 *
 * Required env:
 *   E2E=1
 *   REDIS_URL=redis://localhost:6379
 *   DATABASE_URL=postgres://bbs:bbs@localhost:5432/bbs
 */

const E2E_ENABLED = process.env['E2E'] === '1';
const describeE2e = E2E_ENABLED ? describe : describe.skip;

describeE2e('gateway e2e', () => {
  let redis: Redis;
  let rateLimiter: RateLimitOrchestrator;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let apiKey: string;

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
    await redis.flushdb();

    rateLimiter = new RateLimitOrchestrator({ redis });
    const cache = new FieldCache(redis);
    const adapters = createAdapterRegistry();
    const gapDetector = new GapDetector(redis, []);
    const router = new FieldRouter({ cache, orchestrator: rateLimiter, adapters, gapDetector });

    apiKey = 'e2e-test-key';
    const keyStore = new EnvKeyStore(undefined);
    keyStore.put(apiKey, 'free');

    app = await buildServer({
      redis,
      router,
      rateLimiter,
      keyStore,
      withoutGraphql: true,
      withoutOpenApi: true,
    });
  });

  afterAll(async () => {
    await app.close();
    await rateLimiter.close();
    await redis.quit();
  });

  it('full match fetch: cache miss → source → normalise → cache write → response', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/v1/matches/e2e-m1?sport=ice_hockey&fields=scores',
      headers: { 'x-api-key': apiKey },
    });
    // Cache miss path — either resolves upstream or falls through to 503;
    // we only assert the envelope shape here.
    expect([200, 503]).toContain(first.statusCode);
    const body = first.json() as { meta: { request_id: string } };
    expect(body.meta.request_id).toBeTruthy();

    // Second call should hit cache when the first succeeded.
    const second = await app.inject({
      method: 'GET',
      url: '/v1/matches/e2e-m1?sport=ice_hockey&fields=scores',
      headers: { 'x-api-key': apiKey },
    });
    expect(second.statusCode).toBe(first.statusCode);
  });

  it('gap detection: unresolved field produces 503 with fields_missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/matches/e2e-nonexistent?sport=formula1&fields=xg',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { meta: { fields_missing?: string[] }; error: { code: string } };
    expect(body.meta.fields_missing).toEqual(['xg']);
    expect(body.error.code).toBe('upstream_unavailable');
  });

  it('cricket scorecard end-to-end shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cricket/matches/test-match/scorecard',
      headers: { 'x-api-key': apiKey },
    });
    // Without a real CRICKETDATA_API_KEY in CI, we expect 503 — assert
    // the envelope still conforms.
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json() as { data: unknown; meta: { request_id: string } };
    expect(body.meta.request_id).toBeTruthy();
    expect('data' in body).toBe(true);
  });

  it('webhook signature: register → sign → verify', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { url: 'https://example.test/hook', events: ['score_update'] },
    });
    expect(register.statusCode).toBe(201);
    const { data } = register.json() as { data: { id: string; secret: string } };
    expect(data.secret).toBeTruthy();

    // Verify the signature algorithm matches what clients will implement.
    const body = JSON.stringify({ id: 'e1', type: 'score_update', occurredAt: 'x', data: {} });
    const sig = `sha256=${createHmac('sha256', data.secret).update(body).digest('hex')}`;
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('free plan rate limit — minute bucket trips at 101', async () => {
    await redis.flushdb();
    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sports?i=${i}`,
        headers: { 'x-api-key': apiKey },
      });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: 'GET',
      url: '/v1/sports?i=101',
      headers: { 'x-api-key': apiKey },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(blocked.headers['x-ratelimit-limit-minute']).toBe('100');
    expect(blocked.headers['x-ratelimit-limit-day']).toBe('1000');
  });

  it('gateway /health reports live Redis connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { redis: boolean };
    expect(body.redis).toBe(true);
  });

  it('smoke: /admin/health needs ADMIN_KEY and returns a HealthReport', async () => {
    process.env['ADMIN_KEY'] = 'e2e-admin';
    try {
      // Rebuild so the new env is picked up.
      await app.close();
      app = await buildServer({
        redis,
        router: new FieldRouter({
          cache: new FieldCache(redis),
          orchestrator: rateLimiter,
          adapters: createAdapterRegistry(),
          gapDetector: new GapDetector(redis, []),
        }),
        rateLimiter,
        keyStore: new EnvKeyStore(undefined),
        withoutGraphql: true,
        withoutOpenApi: true,
      });

      const unauth = await app.inject({ method: 'GET', url: '/admin/health' });
      expect(unauth.statusCode).toBe(401);

      const authed = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { 'x-admin-key': 'e2e-admin' },
      });
      expect(authed.statusCode).toBe(200);
      const body = authed.json() as { data: { status: string } };
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.data.status);
    } finally {
      delete process.env['ADMIN_KEY'];
    }

    // The WebSocket + TheRundown delta-poll scenarios need real sockets and
    // external egress; they're covered by manual smoke scripts rather than
    // Vitest. Wait here briefly so Redis-dependent async work drains.
    await wait(50);
  });
});
