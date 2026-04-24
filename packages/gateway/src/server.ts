import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { FieldRouter, RateLimitOrchestrator } from '@bbs/orchestrator';
import requestIdPlugin from './request-id.js';
import authPlugin from './auth.js';
import openApiPlugin from './openapi.js';
import graphqlPlugin from './graphql/index.js';
import usageLoggerPlugin from './middlewares/usage-logger.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerSportsRoutes } from './routes/sports.js';
import { registerMatchesRoutes } from './routes/matches.js';
import { registerStoredMatchesRoutes } from './routes/stored-matches.js';
import { registerStoredStandingsRoutes } from './routes/stored-standings.js';
import { registerStoredPlayersRoutes } from './routes/stored-players.js';
import { registerStoredStatsRoutes } from './routes/stored-stats.js';
import { registerTeamsRoutes } from './routes/teams.js';
import { registerPlayersRoutes } from './routes/players.js';
import { registerStandingsRoutes } from './routes/standings.js';
import { registerInjuriesRoutes } from './routes/injuries.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerCricketRoutes } from './routes/cricket.js';
import { registerCombatRoutes } from './routes/combat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { errorEnvelope } from './response.js';
import { ERROR_CODES } from './errors.js';
import { requestDurationSeconds, requestsTotal } from './metrics.js';
import type { KeyStore } from './key-store.js';
import { WebhookStore } from './webhooks/store.js';
import type { AuthedRequest } from './auth.js';

export interface GatewayDeps {
  readonly redis: Redis;
  readonly router: FieldRouter;
  /** Optional — enables /admin routes when provided. */
  readonly rateLimiter?: RateLimitOrchestrator;
  /** Postgres pool — enables usage-logging + /platform BFF routes. */
  readonly pgPool?: Pool;
  /** Optional override — defaults to `EnvKeyStore` reading `API_KEYS_JSON`. */
  readonly keyStore?: KeyStore;
  /** Skip auth entirely; enables an open gateway for local dev. */
  readonly disableAuth?: boolean;
  /** Skip the (heavyweight) GraphQL plugin. Useful in tests. */
  readonly withoutGraphql?: boolean;
  /** Skip the OpenAPI plugin (it loads a fair chunk of static assets). */
  readonly withoutOpenApi?: boolean;
  /** Override the CORS origin policy. */
  readonly corsOrigin?: string | string[] | RegExp | true;
}

/**
 * Build the Fastify instance with the full gateway surface:
 *   - security (helmet) + CORS + compression
 *   - request-id + auth + per-key rate limit
 *   - OpenAPI / Swagger UI
 *   - REST routes
 *   - GraphQL at /graphql
 *
 * The HTTP server itself (socket.io bind, listen, shutdown) is the
 * caller's responsibility — see `main.ts`.
 */
export async function buildServer(deps: GatewayDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    disableRequestLogging: false,
    trustProxy: true,
  });

  // ------- security / transport --------------------------------------------

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: deps.corsOrigin ?? true });
  await app.register(compress, { encodings: ['gzip', 'br'] });

  // ------- request-id + auth ----------------------------------------------

  await app.register(requestIdPlugin);
  await app.register(authPlugin, {
    redis: deps.redis,
    keyStore: deps.keyStore,
    disableAuth: deps.disableAuth ?? false,
  });

  // ------- per-request metrics --------------------------------------------

  app.addHook('onRequest', async (req) => {
    (req as unknown as { _bbsStart: number })._bbsStart = performance.now();
  });
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as unknown as { _bbsStart?: number })._bbsStart;
    const route = req.routeOptions?.url ?? 'unknown';
    const status = String(reply.statusCode);
    requestsTotal.inc({ route, status });
    if (typeof start === 'number') {
      requestDurationSeconds.observe({ route, status }, (performance.now() - start) / 1000);
    }
  });

  // ------- global error handlers ------------------------------------------

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'unhandled error');
    const rid = (req as AuthedRequest).requestId ?? req.id;
    return reply
      .status(500)
      .send(errorEnvelope(ERROR_CODES.INTERNAL, 'internal server error', rid));
  });
  app.setNotFoundHandler((req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? req.id;
    return reply
      .status(404)
      .send(errorEnvelope(ERROR_CODES.NOT_FOUND, `no route: ${req.method} ${req.url}`, rid));
  });

  // ------- public + REST routes -------------------------------------------

  if (!deps.withoutOpenApi) await app.register(openApiPlugin);

  await registerHealthRoute(app, deps);
  await registerMetricsRoute(app);

  await registerSportsRoutes(app);
  await registerMatchesRoutes(app, deps);
  await registerTeamsRoutes(app, deps);
  await registerPlayersRoutes(app, deps);
  await registerStandingsRoutes(app, deps);
  await registerInjuriesRoutes(app, deps);
  await registerWebhookRoutes(app, { store: new WebhookStore(deps.redis) });
  await registerCricketRoutes(app, deps);
  await registerCombatRoutes(app, deps);

  if (deps.rateLimiter) {
    await registerAdminRoutes(app, {
      redis: deps.redis,
      rateLimiter: deps.rateLimiter,
    });
  }

  if (deps.pgPool) {
    await app.register(usageLoggerPlugin, { pool: deps.pgPool });
    await registerPlatformRoutes(app, { pool: deps.pgPool });
    await registerStoredMatchesRoutes(app, { pgPool: deps.pgPool });
    await registerStoredStandingsRoutes(app, { pgPool: deps.pgPool });
    await registerStoredPlayersRoutes(app, { pgPool: deps.pgPool });
    await registerStoredStatsRoutes(app, { pgPool: deps.pgPool });
  }

  // ------- GraphQL --------------------------------------------------------

  if (!deps.withoutGraphql) {
    await app.register(graphqlPlugin, { router: deps.router });
  }

  return app;
}
