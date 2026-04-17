import { db } from './db.js';

/**
 * Usage analytics queries backing the dashboard charts.
 * All queries take a keyId (per-user isolation) + a time range.
 */

export interface UsageSummary {
  readonly totalRequests: number;
  readonly errorCount: number;
  readonly errorRatePct: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly p99LatencyMs: number | null;
}

export interface TimeSeriesPoint {
  readonly bucket: string;
  readonly api: number;
  readonly cache: number;
  readonly mcp: number;
}

export interface TopEndpointRow {
  readonly endpoint: string;
  readonly count: number;
}

export interface TopSportRow {
  readonly sport: string;
  readonly count: number;
}

function since(fromIso?: string): string {
  const d = fromIso ? new Date(fromIso) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export async function getSummary(
  keyId: string,
  fromIso?: string,
  toIso: string = new Date().toISOString(),
): Promise<UsageSummary> {
  const result = await db().query<{
    total: string;
    errors: string;
    p50: string | null;
    p95: string | null;
    p99: string | null;
  }>(
    `SELECT
       COUNT(*)                                                    AS total,
       COUNT(*) FILTER (WHERE status_code >= 400)                  AS errors,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms)    AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)    AS p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)    AS p99
     FROM usage_events
     WHERE key_id = $1
       AND occurred_at >= $2::timestamptz
       AND occurred_at <= $3::timestamptz`,
    [keyId, since(fromIso), toIso],
  );
  const r = result.rows[0];
  const total = Number(r?.total ?? 0);
  const errors = Number(r?.errors ?? 0);
  return {
    totalRequests: total,
    errorCount: errors,
    errorRatePct: total > 0 ? Number(((errors / total) * 100).toFixed(2)) : 0,
    p50LatencyMs: r?.p50 === null || r?.p50 === undefined ? null : Number(r.p50),
    p95LatencyMs: r?.p95 === null || r?.p95 === undefined ? null : Number(r.p95),
    p99LatencyMs: r?.p99 === null || r?.p99 === undefined ? null : Number(r.p99),
  };
}

export async function getRequestTimeSeries(
  keyId: string,
  fromIso?: string,
  toIso: string = new Date().toISOString(),
  granularity: 'hour' | 'day' = 'day',
): Promise<TimeSeriesPoint[]> {
  const truncExpr = granularity === 'hour' ? "date_trunc('hour', occurred_at)" : "date_trunc('day', occurred_at)";
  const result = await db().query<{ bucket: Date; via: string; c: string }>(
    `SELECT ${truncExpr} AS bucket, COALESCE(via, 'api') AS via, COUNT(*) AS c
       FROM usage_events
      WHERE key_id = $1 AND occurred_at >= $2::timestamptz AND occurred_at <= $3::timestamptz
      GROUP BY bucket, via
      ORDER BY bucket ASC`,
    [keyId, since(fromIso), toIso],
  );
  interface MutablePoint { bucket: string; api: number; cache: number; mcp: number }
  const byBucket = new Map<string, MutablePoint>();
  for (const row of result.rows) {
    const k = row.bucket.toISOString();
    const existing: MutablePoint = byBucket.get(k) ?? { bucket: k, api: 0, cache: 0, mcp: 0 };
    const c = Number(row.c);
    if (row.via === 'cache') existing.cache = c;
    else if (row.via === 'mcp') existing.mcp = c;
    else existing.api = c;
    byBucket.set(k, existing);
  }
  return Array.from(byBucket.values());
}

export async function getTopEndpoints(
  keyId: string,
  fromIso?: string,
  limit = 10,
): Promise<TopEndpointRow[]> {
  const result = await db().query<{ endpoint: string; c: string }>(
    `SELECT endpoint, COUNT(*) AS c
       FROM usage_events
      WHERE key_id = $1 AND occurred_at >= $2::timestamptz
      GROUP BY endpoint
      ORDER BY c DESC
      LIMIT $3`,
    [keyId, since(fromIso), limit],
  );
  return result.rows.map((r) => ({ endpoint: r.endpoint, count: Number(r.c) }));
}

export async function getTopSports(
  keyId: string,
  fromIso?: string,
  limit = 10,
): Promise<TopSportRow[]> {
  const result = await db().query<{ sport: string; c: string }>(
    `SELECT COALESCE(sport, 'unknown') AS sport, COUNT(*) AS c
       FROM usage_events
      WHERE key_id = $1 AND occurred_at >= $2::timestamptz
      GROUP BY sport
      ORDER BY c DESC
      LIMIT $3`,
    [keyId, since(fromIso), limit],
  );
  return result.rows.map((r) => ({ sport: r.sport, count: Number(r.c) }));
}

export async function recordUsageEvent(params: {
  keyId: string;
  endpoint: string;
  sport?: string;
  field?: string;
  via?: 'api' | 'cache' | 'mcp';
  statusCode: number;
  latencyMs: number;
  datapoints?: number;
}): Promise<void> {
  await db()
    .query(
      `INSERT INTO usage_events
         (key_id, endpoint, sport, field, via, status_code, latency_ms, datapoints)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.keyId,
        params.endpoint,
        params.sport ?? null,
        params.field ?? null,
        params.via ?? 'api',
        params.statusCode,
        params.latencyMs,
        params.datapoints ?? 1,
      ],
    )
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[platform:usage] insert failed: ${msg}`);
    });
}
