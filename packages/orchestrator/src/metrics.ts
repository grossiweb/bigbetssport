import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Package-local Prometheus registry. We avoid the prom-client global default
 * so this package's metrics don't leak into unrelated imports.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'orchestrator' });
collectDefaultMetrics({ register: registry });

export const requestsTotal = new Counter({
  name: 'bbs_orchestrator_requests_total',
  help: 'Total orchestrator requests by field and sport.',
  labelNames: ['field', 'sport'],
  registers: [registry],
});

export const cacheHitsTotal = new Counter({
  name: 'bbs_orchestrator_cache_hits_total',
  help: 'Total cache hits by field.',
  labelNames: ['field'],
  registers: [registry],
});

export const cacheMissesTotal = new Counter({
  name: 'bbs_orchestrator_cache_misses_total',
  help: 'Total cache misses by field.',
  labelNames: ['field'],
  registers: [registry],
});

export const quotaRejectsTotal = new Counter({
  name: 'bbs_orchestrator_quota_rejects_total',
  help: 'Quota-rejected selections by source and reason (day/minute).',
  labelNames: ['source', 'reason'],
  registers: [registry],
});

export const cbSkipsTotal = new Counter({
  name: 'bbs_orchestrator_cb_skips_total',
  help: 'Selections skipped because the circuit breaker was open.',
  labelNames: ['source'],
  registers: [registry],
});

export const cbOpensTotal = new Counter({
  name: 'bbs_orchestrator_cb_opens_total',
  help: 'Circuit-breaker open transitions.',
  labelNames: ['source'],
  registers: [registry],
});

export const jobsEnqueuedTotal = new Counter({
  name: 'bbs_orchestrator_jobs_enqueued_total',
  help: 'Jobs enqueued to ingest queues.',
  labelNames: ['queue', 'field', 'source'],
  registers: [registry],
});

export const unavailableTotal = new Counter({
  name: 'bbs_orchestrator_unavailable_total',
  help: 'Requests that could not be satisfied because no eligible source was available.',
  labelNames: ['field', 'sport'],
  registers: [registry],
});

export const sourcesHealthy = new Gauge({
  name: 'bbs_orchestrator_sources_healthy',
  help: 'Number of sources currently healthy (breaker closed and within quota).',
  registers: [registry],
});

export type MetricsRegistry = typeof registry;
