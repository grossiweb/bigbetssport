import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Package-local Prometheus registry for the gateway. Kept separate from the
 * orchestrator's registry so the two services export distinct metric sets
 * even if they end up in the same process during tests.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'gateway' });
collectDefaultMetrics({ register: registry });

export const requestsTotal = new Counter({
  name: 'bbs_gateway_requests_total',
  help: 'HTTP requests handled by the gateway.',
  labelNames: ['route', 'status'],
  registers: [registry],
});

export const requestDurationSeconds = new Histogram({
  name: 'bbs_gateway_request_duration_seconds',
  help: 'Wall-clock duration of gateway requests.',
  labelNames: ['route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const fieldsReturnedTotal = new Counter({
  name: 'bbs_gateway_fields_returned_total',
  help: 'Fields successfully returned to clients, labelled by source and `via`.',
  labelNames: ['field', 'via'],
  registers: [registry],
});

export const fieldsMissingTotal = new Counter({
  name: 'bbs_gateway_fields_missing_total',
  help: 'Fields reported as missing (queued or unavailable) on a response.',
  labelNames: ['field', 'reason'],
  registers: [registry],
});
