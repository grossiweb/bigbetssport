import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createYoga, createSchema } from 'graphql-yoga';
import type { FieldRouter } from '@bbs/orchestrator';
import { typeDefs } from './schema.js';
import { createResolvers, type ResolverContext } from './resolvers.js';

/**
 * Mount GraphQL Yoga at `/graphql`. Context is built per-request so each
 * resolver sees the shared `FieldRouter`.
 */

export interface GraphQlPluginOptions {
  readonly router: FieldRouter;
  readonly path?: string;
}

async function graphqlPlugin(app: FastifyInstance, opts: GraphQlPluginOptions): Promise<void> {
  const path = opts.path ?? '/graphql';
  const yoga = createYoga<{ req: FastifyRequest; reply: FastifyReply }>({
    schema: createSchema<{ req: FastifyRequest; reply: FastifyReply }>({
      typeDefs,
      // Cast: resolvers declare a ResolverContext-shaped `ctx`, but Yoga's
      // generated schema type is parametrised differently. Safe because
      // we wire the router via our own `context` callback below.
      resolvers: createResolvers() as never,
    }),
    graphqlEndpoint: path,
    logging: false,
    landingPage: false,
    context: (): ResolverContext => ({ router: opts.router }),
  });

  app.route({
    url: path,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: async (req, reply) => {
      const response = await yoga.handleNodeRequestAndResponse(req, reply, { req, reply });
      for (const [k, v] of response.headers.entries()) void reply.header(k, v);
      void reply.status(response.status);
      reply.send(response.body);
      return reply;
    },
  });
}

export default fp(graphqlPlugin, { name: 'bbs-graphql' });
