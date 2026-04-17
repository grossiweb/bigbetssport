import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * OpenAPI 3.1 scaffold. Route schemas are auto-collected by @fastify/swagger
 * from whatever Zod-derived or JSON schemas each route declares. Swagger UI
 * is served at `/v1/docs` and the raw spec at `/v1/docs/json`.
 *
 * These paths are whitelisted in `auth.ts`'s default `publicPaths` so the
 * docs are reachable without an API key.
 */

async function openApiPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Big Ball Sports API',
        description:
          'Unified sports data API aggregating 20 free-tier upstream sources and 10 MCP scrapers behind a Stripe-style gateway.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
            description:
              'Your Big Ball Sports API key. Alternatively pass `Authorization: Bearer <key>`.',
          },
        },
      },
      security: [{ apiKey: [] }],
      tags: [
        { name: 'sports', description: 'Sport + league catalogue' },
        { name: 'matches', description: 'Match, score, odds, and event data' },
        { name: 'teams', description: 'Team profiles and match history' },
        { name: 'players', description: 'Player profiles and stats' },
        { name: 'standings', description: 'League tables' },
        { name: 'injuries', description: 'Injury reports' },
        { name: 'webhooks', description: 'Webhook subscriptions' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/v1/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  });
}

export default fp(openApiPlugin, { name: 'bbs-openapi' });
