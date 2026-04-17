/**
 * Webhook event types emitted by the gateway. Clients subscribe to any
 * subset of these via POST /v1/webhooks.
 */
export const WEBHOOK_EVENT_TYPES = [
  'score_update',
  'odds_move',
  'lineup_confirmed',
  'match_start',
  'match_end',
  'goal',
  'card',
  'substitution',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookRegistration {
  readonly id: string;
  readonly keyId: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly WebhookEventType[];
  readonly createdAt: string;
}

export interface WebhookEvent {
  readonly id: string;
  readonly type: WebhookEventType;
  readonly payload: unknown;
  readonly occurredAt: string;
}
