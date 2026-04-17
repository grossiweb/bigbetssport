import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import {
  RPC_ERROR,
  type RpcFailure,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccess,
  type ToolHandler,
} from './rpc.js';

/**
 * Abstract base for every MCP scraper. Subclasses declare their id, port,
 * rate-limit, and tool map; the base handles Fastify bootstrap, JSON-RPC
 * dispatch, and per-hour sliding-window rate limiting in Redis.
 */

const WINDOW_MS = 3_600_000;
const EXPIRE_SECONDS = 3_700;

export abstract class McpScraperServer {
  protected abstract readonly scraperId: string;
  protected abstract readonly port: number;
  protected abstract readonly rateLimit: number;
  protected abstract readonly tools: Readonly<Record<string, ToolHandler>>;

  protected readonly app: FastifyInstance;

  constructor(protected readonly redis: Redis) {
    this.app = Fastify({
      logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
      disableRequestLogging: false,
    });
  }

  async start(): Promise<void> {
    this.app.get('/health', async () => ({
      status: 'ok',
      scraper: this.scraperId,
      tools: Object.keys(this.tools),
    }));

    this.app.post('/mcp', async (req, reply) => {
      const response = await this.handleRpcCall(req.body as RpcRequest);
      const statusCode = 'error' in response ? this.httpStatusFor(response) : 200;
      return reply.status(statusCode).send(response);
    });

    await this.app.listen({ host: '0.0.0.0', port: this.port });
    this.app.log.info(`${this.scraperId} listening on :${this.port}`);
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  /**
   * Sliding-window rate limiter, per-scraper. ZSET with timestamp scores:
   *   1. drop entries older than 1 hour
   *   2. count — if >= rateLimit, reject
   *   3. add this attempt
   */
  async checkRateLimit(): Promise<boolean> {
    const now = Date.now();
    const key = `mcp:rate:${this.scraperId}`;
    await this.redis.zremrangebyscore(key, '-inf', now - WINDOW_MS);
    const count = await this.redis.zcard(key);
    if (count >= this.rateLimit) return false;
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, EXPIRE_SECONDS);
    return true;
  }

  /**
   * Exposed for tests; callers outside the server shouldn't invoke this.
   */
  async handleRpcCall(req: RpcRequest): Promise<RpcResponse> {
    if (!req || req.jsonrpc !== '2.0') {
      return this.rpcError(req?.id ?? null, RPC_ERROR.INVALID_REQUEST, 'invalid JSON-RPC request');
    }
    if (req.method !== 'tools/call') {
      return this.rpcError(req.id, RPC_ERROR.METHOD_NOT_FOUND, `method not found: ${req.method}`);
    }

    const toolName = req.params?.name;
    const handler = toolName ? this.tools[toolName] : undefined;
    if (!toolName || !handler) {
      return this.rpcError(
        req.id,
        RPC_ERROR.METHOD_NOT_FOUND,
        `unknown tool: ${toolName ?? '(missing)'}`,
      );
    }

    if (!(await this.checkRateLimit())) {
      return this.rpcError(req.id, RPC_ERROR.RATE_LIMITED, 'rate limit exceeded');
    }

    try {
      const result = await handler(req.params?.arguments ?? {});
      return this.rpcSuccess(req.id, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.rpcError(req.id, RPC_ERROR.INTERNAL, `scraper error: ${msg}`);
    }
  }

  protected rpcSuccess(id: number | string | null, result: unknown): RpcSuccess {
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    };
  }

  protected rpcError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): RpcFailure {
    return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
  }

  private httpStatusFor(response: RpcFailure): number {
    switch (response.error.code) {
      case RPC_ERROR.METHOD_NOT_FOUND:
        return 404;
      case RPC_ERROR.INVALID_REQUEST:
      case RPC_ERROR.INVALID_PARAMS:
      case RPC_ERROR.PARSE:
        return 400;
      case RPC_ERROR.RATE_LIMITED:
        return 429;
      default:
        return 500;
    }
  }
}
