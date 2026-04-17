import type { Server as HttpServer } from 'node:http';
import { Server as IoServer, type Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { hashKey } from './key-store.js';
import type { KeyStore } from './key-store.js';
import { EnvKeyStore } from './key-store.js';

/**
 * socket.io bridge fed by Redis pub/sub.
 *
 * Rooms emitted into:
 *   sport:{sport}        — broadcast, coarse-grained
 *   league:{leagueId}    — sport-agnostic league feeds
 *   match:{matchId}      — finest-grained per-match feed
 *
 * Clients authenticate via the same `x-api-key` header used by REST.
 * Subscribe to `bbs:updates:{sportId}` channels (one per sport) — payloads
 * are JSON with `{ type, sport?, leagueId?, matchId?, data }`.
 */

export interface WebSocketOptions {
  readonly httpServer: HttpServer;
  readonly subscriber: Redis;
  readonly keyStore?: KeyStore;
  readonly disableAuth?: boolean;
}

interface UpdatePayload {
  readonly type: string;
  readonly sport?: string;
  readonly leagueId?: string;
  readonly matchId?: string;
  readonly data: unknown;
}

const EMITTABLE_EVENTS = new Set([
  'score_update',
  'odds_move',
  'lineup_confirmed',
  'match_start',
  'match_end',
  'goal',
  'card',
  'substitution',
]);

export function attachWebSocket(opts: WebSocketOptions): IoServer {
  const io = new IoServer(opts.httpServer, {
    cors: { origin: '*' },
    serveClient: false,
    path: '/socket.io',
  });
  const keyStore = opts.keyStore ?? new EnvKeyStore();

  io.use(async (socket, next) => {
    if (opts.disableAuth) return next();
    const raw =
      (socket.handshake.headers['x-api-key'] as string | undefined) ??
      (socket.handshake.auth as { apiKey?: string } | undefined)?.apiKey;
    if (typeof raw !== 'string' || raw.length === 0) {
      return next(new Error('missing API key'));
    }
    const record = await keyStore.lookup(hashKey(raw));
    if (!record) return next(new Error('invalid API key'));
    (socket.data as { keyId?: string }).keyId = record.keyId;
    return next();
  });

  io.on('connection', (socket: Socket) => {
    socket.on('join', (room: unknown) => {
      if (typeof room !== 'string' || room.length === 0) return;
      if (!/^(sport|league|match):/.test(room)) return;
      void socket.join(room);
    });
    socket.on('leave', (room: unknown) => {
      if (typeof room === 'string' && room.length > 0) void socket.leave(room);
    });
  });

  // Single subscriber for all sport channels.
  void opts.subscriber.psubscribe('bbs:updates:*');
  opts.subscriber.on('pmessage', (_pattern, _channel, message) => {
    let parsed: UpdatePayload;
    try {
      parsed = JSON.parse(message) as UpdatePayload;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    if (!EMITTABLE_EVENTS.has(parsed.type)) return;

    if (parsed.sport) io.to(`sport:${parsed.sport}`).emit(parsed.type, parsed.data);
    if (parsed.leagueId) io.to(`league:${parsed.leagueId}`).emit(parsed.type, parsed.data);
    if (parsed.matchId) io.to(`match:${parsed.matchId}`).emit(parsed.type, parsed.data);
  });

  return io;
}

