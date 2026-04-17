import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Shared Big Ball Sports Prometheus metrics + logger.
 *
 * Every package imports from here so the same counter/gauge instance is
 * shared across the process. Each service's `/metrics` endpoint merges
 * `bbsRegistry` with its local registry so both surfaces are exposed.
 *
 * Metric name convention: `bbs_<subsystem>_<thing>_<unit>`.
 *
 * 3-state circuit-breaker gauge encoding:
 *   closed    → 0
 *   open      → 1
 *   half-open → 2
 */

export const bbsRegistry = new Registry();
bbsRegistry.setDefaultLabels({ service: 'bbs' });

export const quotaUsedTotal = new Counter({
  name: 'bbs_quota_used_total',
  help: 'Quota tokens consumed, by source and field.',
  labelNames: ['source_id', 'field'],
  registers: [bbsRegistry],
});

export const quotaRemaining = new Gauge({
  name: 'bbs_quota_remaining',
  help: 'Remaining quota tokens for a source + bucket.',
  labelNames: ['source_id', 'bucket'],
  registers: [bbsRegistry],
});

export const circuitState = new Gauge({
  name: 'bbs_circuit_state',
  help: 'Circuit breaker state per source: 0=closed, 1=open, 2=half-open.',
  labelNames: ['source_id'],
  registers: [bbsRegistry],
});

export const CIRCUIT_STATE_CODE = Object.freeze({
  closed: 0,
  open: 1,
  'half-open': 2,
}) as Readonly<Record<string, number>>;

export const fieldFetchDuration = new Histogram({
  name: 'bbs_field_fetch_duration_ms',
  help: 'Wall-clock duration of a field fetch.',
  labelNames: ['source_id', 'field', 'via'],
  buckets: [10, 50, 100, 250, 500, 1_000, 2_000],
  registers: [bbsRegistry],
});

export const gapDetectedTotal = new Counter({
  name: 'bbs_gap_detected_total',
  help: 'Gaps that fell through every API source to the MCP fallback layer.',
  labelNames: ['field', 'sport'],
  registers: [bbsRegistry],
});

export const mcpDispatchTotal = new Counter({
  name: 'bbs_mcp_dispatch_total',
  help: 'MCP scraper dispatches, broken down by outcome.',
  labelNames: ['scraper_id', 'tool', 'success'],
  registers: [bbsRegistry],
});

export const cacheHitTotal = new Counter({
  name: 'bbs_cache_hit_total',
  help: 'Field-cache hits.',
  labelNames: ['field'],
  registers: [bbsRegistry],
});

export const cacheMissTotal = new Counter({
  name: 'bbs_cache_miss_total',
  help: 'Field-cache misses.',
  labelNames: ['field'],
  registers: [bbsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'bbs_http_requests_total',
  help: 'HTTP requests served by the gateway.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [bbsRegistry],
});

export const wsConnections = new Gauge({
  name: 'bbs_ws_connections',
  help: 'Active WebSocket connections grouped by room type.',
  labelNames: ['room_type'],
  registers: [bbsRegistry],
});

/**
 * Reset every metric's sample set — used only by tests that need a clean
 * slate between cases. Not safe to call in production.
 */
export function resetSharedMetrics(): void {
  bbsRegistry.resetMetrics();
}
