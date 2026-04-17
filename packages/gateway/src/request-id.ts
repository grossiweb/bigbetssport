import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Attach a UUIDv4 `request_id` to every request and echo it back as
 * `X-Request-Id`. Honours an inbound `X-Request-Id` header when present so
 * upstream proxies can correlate logs.
 */
async function requestIdPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const inbound = req.headers['x-request-id'];
    const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
    (req as unknown as { requestId: string }).requestId = id;
    void reply.header('x-request-id', id);
  });
}

export default fp(requestIdPlugin, { name: 'bbs-request-id' });
