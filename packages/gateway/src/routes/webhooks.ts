import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorEnvelope } from '../response.js';
import { ERROR_CODES } from '../errors.js';
import type { AuthedRequest } from '../auth.js';
import type { WebhookStore } from '../webhooks/store.js';
import { WEBHOOK_EVENT_TYPES } from '../webhooks/types.js';

export interface WebhookRouteDeps {
  readonly store: WebhookStore;
}

const RegisterBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
});

function envelope<T>(data: T, requestId: string) {
  return {
    data,
    meta: {
      source: 'gateway',
      confidence: 1,
      cached: false,
      cache_age_ms: 0,
      request_id: requestId,
    },
    error: null,
  };
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookRouteDeps,
): Promise<void> {
  app.post('/v1/webhooks', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const keyId = (req as AuthedRequest).auth?.keyId;
    if (!keyId) {
      return reply
        .status(401)
        .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'authentication required', rid));
    }
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            ERROR_CODES.BAD_REQUEST,
            'invalid webhook registration body',
            rid,
            parsed.error.flatten(),
          ),
        );
    }
    const reg = await deps.store.register({
      keyId,
      url: parsed.data.url,
      events: parsed.data.events,
    });
    return reply.status(201).send(
      envelope(
        {
          id: reg.id,
          url: reg.url,
          events: reg.events,
          secret: reg.secret,
          createdAt: reg.createdAt,
        },
        rid,
      ),
    );
  });

  app.get('/v1/webhooks', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const keyId = (req as AuthedRequest).auth?.keyId;
    if (!keyId) {
      return reply
        .status(401)
        .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'authentication required', rid));
    }
    const records = await deps.store.listByKey(keyId);
    return envelope(
      records.map((r) => ({
        id: r.id,
        url: r.url,
        events: r.events,
        createdAt: r.createdAt,
      })),
      rid,
    );
  });

  app.delete<{ Params: { id: string } }>('/v1/webhooks/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const keyId = (req as AuthedRequest).auth?.keyId;
    if (!keyId) {
      return reply
        .status(401)
        .send(errorEnvelope(ERROR_CODES.UNAUTHORIZED, 'authentication required', rid));
    }
    const removed = await deps.store.delete(req.params.id, keyId);
    if (!removed) {
      return reply
        .status(404)
        .send(errorEnvelope(ERROR_CODES.NOT_FOUND, 'webhook not found', rid));
    }
    return reply.status(204).send();
  });
}
