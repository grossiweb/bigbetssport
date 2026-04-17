import type { Redis } from 'ioredis';
import type { FetchParams, FieldKey, FieldResult, McpScraper } from '@bbs/shared';
import { childLogger, mcpDispatchTotal } from '@bbs/shared';

const gapLog = childLogger({ component: 'gap-detector' });

/**
 * Gap detector / MCP fallback dispatcher.
 *
 * When the field router can't satisfy a request from any upstream API, it
 * hands control here. We look for an MCP scraper that covers the
 * (field, sport) pair, check a per-hour rate bucket in Redis, fire a
 * JSON-RPC `tools/call` at the scraper's MCP server, and shape the response
 * back into a `FieldResult`.
 *
 * MCP results are tagged `via: 'mcp'` with a lower confidence (0.60) so
 * downstream scoring knows it's not first-party.
 */

const HOUR_MS = 60 * 60 * 1_000;
const MCP_CONFIDENCE = 0.6;
const DEFAULT_MCP_TIMEOUT_MS = 15_000;

function quotaKey(scraperId: string): string {
  return `quota:mcp:${scraperId}:hour`;
}

interface McpEnvelope {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: {
    readonly content?: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  };
  readonly error?: { readonly message: string };
}

export class GapDetector {
  constructor(
    private readonly redis: Redis,
    private readonly scrapers: readonly McpScraper[],
    private readonly timeoutMs = DEFAULT_MCP_TIMEOUT_MS,
  ) {}

  /**
   * Find the first MCP scraper that:
   *   - covers the requested field + sport
   *   - has rate-limit budget remaining this hour
   * and dispatch to it. Returns a `FieldResult` on success or null if no
   * scraper can serve the request.
   */
  async triggerGapFill(
    field: FieldKey,
    params: FetchParams,
  ): Promise<FieldResult | null> {
    const candidates = this.scrapers.filter(
      (s) => s.coveredFields.includes(field) && s.coveredSports.includes(params.sport),
    );

    for (const scraper of candidates) {
      if (!(await this.canUseScraper(scraper.id, scraper.rateLimit))) continue;
      const result = await this.dispatch(scraper, field, params);
      if (result !== null) return result;
    }
    return null;
  }

  /**
   * Per-hour token bucket — `rateLimit` is the scraper's per-hour budget.
   * Returns true on allowed-and-consumed, false on exhausted.
   */
  async canUseScraper(scraperId: string, rateLimit: number): Promise<boolean> {
    if (!Number.isFinite(rateLimit) || rateLimit <= 0) return true;
    const key = quotaKey(scraperId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.pexpire(key, HOUR_MS);
    }
    if (count > rateLimit) {
      // Keep the counter at the cap — next hour's TTL expiry will reset it.
      await this.redis.decr(key);
      return false;
    }
    return true;
  }

  private async dispatch(
    scraper: McpScraper,
    field: FieldKey,
    params: FetchParams,
  ): Promise<FieldResult | null> {
    const body = {
      jsonrpc: '2.0' as const,
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: scraper.tool,
        arguments: { field, ...params },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = performance.now();

    try {
      const response = await fetch(scraper.mcpServerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        mcpDispatchTotal.inc({ scraper_id: scraper.id, tool: scraper.tool, success: 'false' });
        gapLog.warn(
          { scraperId: scraper.id, tool: scraper.tool, status: response.status },
          'mcp dispatch failed: non-2xx',
        );
        return null;
      }

      const envelope = (await response.json()) as McpEnvelope;
      const text = envelope.result?.content?.[0]?.text;
      if (typeof text !== 'string') {
        mcpDispatchTotal.inc({ scraper_id: scraper.id, tool: scraper.tool, success: 'false' });
        return null;
      }

      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        mcpDispatchTotal.inc({ scraper_id: scraper.id, tool: scraper.tool, success: 'false' });
        return null;
      }

      mcpDispatchTotal.inc({ scraper_id: scraper.id, tool: scraper.tool, success: 'true' });
      gapLog.info(
        {
          scraperId: scraper.id,
          tool: scraper.tool,
          success: true,
          latencyMs: performance.now() - startedAt,
        },
        'mcp dispatch',
      );

      return {
        value,
        source: scraper.id,
        via: 'mcp',
        confidence: MCP_CONFIDENCE,
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 300,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mcpDispatchTotal.inc({ scraper_id: scraper.id, tool: scraper.tool, success: 'false' });
      gapLog.error({ scraperId: scraper.id, tool: scraper.tool, err: msg }, 'mcp dispatch error');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
