import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import {
  EnvKeyStore,
  AllowAnyKeyStore,
  PLAN_LIMITS,
  hashKey,
  type KeyRecord,
  type KeyStore,
} from './key-store.js';
import { checkAndConsume } from './rate-limit.js';
import { errorEnvelope } from './response.js';
import { ERROR_CODES } from './errors.js';

/**
 * Extract the raw token from either `Authorization: Bearer …` or the
 * `x-api-key` header.
 */
function extractRawKey(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const [scheme, token] = auth.split(/\s+/, 2);
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.length > 0) return x;
  return null;
}

/** Augment the request with auth context so downstream handlers see it. */
export interface AuthedRequest extends FastifyRequest {
  auth?: KeyRecord;
  requestId?: string;
}

export interface AuthPluginOptions {
  readonly redis: Redis;
  readonly keyStore?: KeyStore;
  /** Routes skipped by the auth + rate-limit hook. */
  readonly publicPaths?: readonly string[];
  /** Explicit disable-auth flag for dev/local use. */
  readonly disableAuth?: boolean;
}

const DEFAULT_PUBLIC = [
  '/health',
  '/metrics',
  '/v1/docs',
  '/v1/docs/json',
  '/v1/docs/static',
  // Admin routes have their own admin-key preHandler — the consumer auth
  // plugin must skip them so the two authentication schemes don't collide.
  '/admin',
];

function isPublic(url: string, publicPaths: readonly string[]): boolean {
  // Exact, or the route is a subtree of a listed public prefix.
  for (const p of publicPaths) {
    if (url === p || url.startsWith(p + '/') || url.startsWith(p + '?')) return true;
  }
  return false;
}

/**
 * API-key authentication and per-key rate limiting. Wires a `preHandler`
 * hook that rejects requests without a valid key or over their plan's
 * per-minute limit. Sets `X-RateLimit-*` headers on every protected hit.
 */
async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const publicPaths = opts.publicPaths ?? DEFAULT_PUBLIC;
  const keyStore =
    opts.keyStore ?? (opts.disableAuth ? new AllowAnyKeyStore() : new EnvKeyStore());

  app.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions.url ?? req.url.split('?')[0] ?? req.url;
    if (isPublic(url, publicPaths)) return;

    const requestId = (req as AuthedRequest).requestId ?? 'unknown';

    if (opts.disableAuth) {
      (req as AuthedRequest).auth = {
        keyId: 'dev',
        plan: 'free',
        limits: PLAN_LIMITS.free,
      };
      return;
    }

    const raw = extractRawKey(req);
    if (!raw) {
      return reply
        .status(401)
        .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'missing API key', requestId));
    }

    const record = await keyStore.lookup(hashKey(raw));
    if (!record) {
      return reply
        .status(401)
        .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'invalid API key', requestId));
    }

    const result = await checkAndConsume(opts.redis, record.keyId, record.limits);

    void reply.header(
      'x-ratelimit-limit',
      Number.isFinite(result.limit) ? String(result.limit) : 'unlimited',
    );
    void reply.header(
      'x-ratelimit-remaining',
      Number.isFinite(result.remaining) ? String(result.remaining) : 'unlimited',
    );
    void reply.header('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1000)));
    // Surface per-bucket detail for clients that want the finer-grained view.
    void reply.header(
      'x-ratelimit-limit-minute',
      Number.isFinite(result.minute.limit) ? String(result.minute.limit) : 'unlimited',
    );
    void reply.header(
      'x-ratelimit-limit-day',
      Number.isFinite(result.day.limit) ? String(result.day.limit) : 'unlimited',
    );

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      const unit = result.limitingBucket === 'day' ? '/day' : '/min';
      return reply
        .status(429)
        .header('retry-after', String(retryAfter))
        .send(
          errorEnvelope(
            ERROR_CODES.RATE_LIMITED,
            `rate limit exceeded (${result.limit}${unit})`,
            requestId,
          ),
        );
    }

    (req as AuthedRequest).auth = record;
    return;
  });
}

export default fp(authPlugin, { name: 'bbs-auth' });
