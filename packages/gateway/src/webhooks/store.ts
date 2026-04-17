import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { WebhookEventType, WebhookRegistration } from './types.js';

/**
 * Redis-backed webhook registrations. Indexed two ways:
 *
 *   webhook:{id}             hash  { id, keyId, url, secret, events, createdAt }
 *   webhook:byKey:{keyId}    set   of webhook ids owned by that API key
 *   webhook:byEvent:{type}   set   of webhook ids subscribed to `type`
 *
 * Writes update all three indexes atomically via MULTI.
 */

function recordKey(id: string): string {
  return `webhook:${id}`;
}
function byKey(keyId: string): string {
  return `webhook:byKey:${keyId}`;
}
function byEvent(type: WebhookEventType): string {
  return `webhook:byEvent:${type}`;
}

export class WebhookStore {
  constructor(private readonly redis: Redis) {}

  async register(args: {
    keyId: string;
    url: string;
    events: readonly WebhookEventType[];
  }): Promise<WebhookRegistration> {
    const id = randomUUID();
    const secret = randomUUID().replace(/-/g, '');
    const createdAt = new Date().toISOString();
    const reg: WebhookRegistration = {
      id,
      keyId: args.keyId,
      url: args.url,
      secret,
      events: [...args.events],
      createdAt,
    };

    const multi = this.redis.multi();
    multi.hset(recordKey(id), {
      id,
      keyId: reg.keyId,
      url: reg.url,
      secret: reg.secret,
      events: JSON.stringify(reg.events),
      createdAt,
    });
    multi.sadd(byKey(args.keyId), id);
    for (const evt of args.events) multi.sadd(byEvent(evt), id);
    await multi.exec();

    return reg;
  }

  async listByKey(keyId: string): Promise<WebhookRegistration[]> {
    const ids = await this.redis.smembers(byKey(keyId));
    const out: WebhookRegistration[] = [];
    for (const id of ids) {
      const record = await this.read(id);
      if (record) out.push(record);
    }
    return out;
  }

  async get(id: string): Promise<WebhookRegistration | null> {
    return this.read(id);
  }

  async listByEvent(type: WebhookEventType): Promise<WebhookRegistration[]> {
    const ids = await this.redis.smembers(byEvent(type));
    const out: WebhookRegistration[] = [];
    for (const id of ids) {
      const record = await this.read(id);
      if (record) out.push(record);
    }
    return out;
  }

  async delete(id: string, keyId: string): Promise<boolean> {
    const record = await this.read(id);
    if (!record) return false;
    if (record.keyId !== keyId) return false;

    const multi = this.redis.multi();
    multi.del(recordKey(id));
    multi.srem(byKey(record.keyId), id);
    for (const evt of record.events) multi.srem(byEvent(evt), id);
    await multi.exec();
    return true;
  }

  private async read(id: string): Promise<WebhookRegistration | null> {
    const hash = await this.redis.hgetall(recordKey(id));
    if (!hash || !hash['id']) return null;
    let events: WebhookEventType[] = [];
    try {
      const raw = JSON.parse(hash['events'] ?? '[]') as unknown;
      if (Array.isArray(raw)) events = raw as WebhookEventType[];
    } catch {
      events = [];
    }
    return {
      id: hash['id'] ?? id,
      keyId: hash['keyId'] ?? 'unknown',
      url: hash['url'] ?? '',
      secret: hash['secret'] ?? '',
      events,
      createdAt: hash['createdAt'] ?? new Date().toISOString(),
    };
  }
}
