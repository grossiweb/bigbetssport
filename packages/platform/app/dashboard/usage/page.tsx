import { MetricCard } from '@/components/dashboard/MetricCard';
import { Callout } from '@/components/Callout';

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Usage</h1>
        <p className="mt-1 text-sm text-navy-500">
          Request volumes + latency per endpoint. Populates once per-request
          logging is live.
        </p>
      </div>

      <Callout type="info">
        Usage analytics are wired up in the gateway middleware but disabled
        during early access. Once paid plans go live, this page will render
        Recharts backed by a <code>usage_events</code> time-series table in
        Postgres.
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="p50 latency" value="—" helper="no data yet" />
        <MetricCard label="p95 latency" value="—" helper="no data yet" />
        <MetricCard label="p99 latency" value="—" helper="no data yet" />
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Request volume</h2>
        <p className="text-xs text-navy-500">
          Daily request counts per endpoint — backed by{' '}
          <code className="rounded bg-navy-50 px-1 text-[10px]">getRequestTimeSeries</code>{' '}
          in <code className="rounded bg-navy-50 px-1 text-[10px]">lib/usage.ts</code>.
        </p>
        <div className="mt-4 flex h-56 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
          Chart unlocks once request logging is enabled
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Top endpoints</h2>
          <div className="flex h-48 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            No data yet
          </div>
        </div>
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Top sports</h2>
          <div className="flex h-48 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            No data yet
          </div>
        </div>
      </div>
    </div>
  );
}
