import { createHmac } from 'node:crypto';
import type { WebhookEvent, WebhookRegistration } from './types.js';
import type { WebhookStore } from './store.js';

/**
 * Webhook delivery — signs payloads with HMAC-SHA256 and retries failed
 * POSTs with exponential backoff (1s, 2s, 4s, 8s, 16s; 5 attempts total).
 *
 * Signature header is `X-BBS-Signature: sha256=<hex>` where the hex is
 * HMAC-SHA256 of the raw JSON body using the registration's `secret`.
 */

const BACKOFFS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const TIMEOUT_MS = 10_000;

export function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export interface DeliveryAttempt {
  readonly webhookId: string;
  readonly attempt: number;
  readonly status: number;
  readonly ok: boolean;
  readonly error?: string;
}

export class WebhookDelivery {
  constructor(
    private readonly store: WebhookStore,
    private readonly sleepFn: (ms: number) => Promise<void> = defaultSleep,
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  /**
   * Fan out `event` to every registration whose `events` list includes
   * `event.type`. Each registration gets its own retry loop.
   */
  async deliver(event: WebhookEvent): Promise<DeliveryAttempt[]> {
    const registrations = await this.store.listByEvent(event.type);
    if (registrations.length === 0) return [];

    const attempts = await Promise.all(
      registrations.map(async (reg) => this.deliverOne(reg, event)),
    );
    return attempts.flat();
  }

  /**
   * Deliver to a single registration, retrying up to 5 times. Returns the
   * full attempt list so callers can log each try.
   */
  async deliverOne(
    reg: WebhookRegistration,
    event: WebhookEvent,
  ): Promise<DeliveryAttempt[]> {
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      data: event.payload,
    });
    const signature = sign(body, reg.secret);
    const attempts: DeliveryAttempt[] = [];

    for (let i = 0; i <= BACKOFFS_MS.length; i += 1) {
      const attempt = i + 1;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response: Response;
        try {
          response = await this.fetchFn(reg.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-bbs-signature': signature,
              'x-bbs-event-id': event.id,
              'x-bbs-event-type': event.type,
              'x-bbs-webhook-id': reg.id,
            },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        const result: DeliveryAttempt = {
          webhookId: reg.id,
          attempt,
          status: response.status,
          ok: response.ok,
        };
        attempts.push(result);
        if (response.ok) return attempts;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ webhookId: reg.id, attempt, status: 0, ok: false, error: msg });
      }

      if (i < BACKOFFS_MS.length) {
        const wait = BACKOFFS_MS[i];
        if (wait !== undefined) await this.sleepFn(wait);
      }
    }

    return attempts;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
