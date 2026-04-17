import { MetricCard } from '@/components/dashboard/MetricCard';

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Usage</h1>
        <p className="mt-1 text-sm text-navy-500">
          Request volumes, latency percentiles, and quota consumption per source.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="p50 latency" value="—" helper="last 30 days" />
        <MetricCard label="p95 latency" value="—" helper="last 30 days" />
        <MetricCard label="p99 latency" value="—" helper="last 30 days" />
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Request volume</h2>
        <p className="text-xs text-navy-500">
          Stacked area chart by response source (API / Cache / MCP). Wired to
          <code className="mx-1 rounded bg-navy-50 px-1 text-[10px]">getRequestTimeSeries</code>
          from <code className="rounded bg-navy-50 px-1 text-[10px]">lib/usage.ts</code>.
        </p>
        <div className="mt-4 flex h-56 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
          (Recharts AreaChart — hook up /platform/usage time-series)
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Top endpoints</h2>
          <div className="flex h-48 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            (Top endpoints bar chart)
          </div>
        </div>
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Top sports</h2>
          <div className="flex h-48 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            (Top sports horizontal bar chart)
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Per-source quota</h2>
        <p className="text-xs text-navy-500">
          Daily cap, used today, used this month, % used, reset time per source.
        </p>
        <div className="mt-4 flex h-40 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
          (Source quota table + progress bars — wired via /admin/quota)
        </div>
      </div>
    </div>
  );
}
