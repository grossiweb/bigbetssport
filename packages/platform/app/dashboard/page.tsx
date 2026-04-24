import Link from 'next/link';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { Badge } from '@/components/Badge';
import { auth } from '@/lib/auth';
import { getSummary } from '@/lib/usage';

/**
 * Overview page. Pulls the logged-in user's first API key and shows usage
 * metrics for the last 30 days. Real-time refresh + live activity tail is
 * wired in the dashboard route (see /dashboard/logs) — this page is the
 * at-a-glance summary.
 */
export default async function DashboardOverview() {
  const session = await auth();
  const userId = session?.user.id ?? 'demo';

  let summary = { totalRequests: 0, errorCount: 0, errorRatePct: 0, p50LatencyMs: null as number | null };
  try {
    const s = await getSummary(userId);
    summary = {
      totalRequests: s.totalRequests,
      errorCount: s.errorCount,
      errorRatePct: s.errorRatePct,
      p50LatencyMs: s.p50LatencyMs,
    };
  } catch {
    // DB not reachable — render with zeros rather than crashing.
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Overview</h1>
        <p className="mt-1 text-sm text-navy-500">
          Your API usage at a glance. Last 30 days.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total requests"
          value={summary.totalRequests.toLocaleString()}
          helper="30 days"
        />
        <MetricCard
          label="Error rate"
          value={`${summary.errorRatePct}%`}
          delta={
            summary.errorRatePct > 5
              ? { direction: 'down', text: '↑ investigate' }
              : { direction: 'up', text: 'Healthy' }
          }
        />
        <MetricCard
          label="Median latency"
          value={
            summary.p50LatencyMs !== null
              ? `${Math.round(summary.p50LatencyMs)}ms`
              : '—'
          }
          helper="p50"
        />
        <MetricCard
          label="Plan"
          value={<span className="capitalize">Free</span>}
          helper="1,000 req/day"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Requests by sport</h2>
          <p className="text-xs text-navy-500">
            Per-sport request breakdown. Chart renders once data flows through.
          </p>
          <div className="mt-4 flex h-40 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            (Recharts bar chart — hook up /platform/usage data)
          </div>
        </div>
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Response source</h2>
          <p className="text-xs text-navy-500">
            Where your data came from: direct API, cache, or MCP fallback.
          </p>
          <div className="mt-4 flex h-40 items-center justify-center rounded-lg bg-navy-50 text-xs text-navy-400">
            (Recharts donut chart — api / cache / mcp)
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-800">What's new</h2>
          <Link href="/changelog" className="text-xs text-brand-700 hover:underline">
            View changelog →
          </Link>
        </div>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <Badge color="blue">New</Badge>
            <div>
              <div className="font-medium text-navy-800">WebSocket subscriptions available on Pro</div>
              <div className="text-xs text-navy-500">2026-05-15</div>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Badge color="blue">New</Badge>
            <div>
              <div className="font-medium text-navy-800">Cricket, MMA and Boxing support added</div>
              <div className="text-xs text-navy-500">2026-04-15</div>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Badge color="green">Improved</Badge>
            <div>
              <div className="font-medium text-navy-800">Initial release</div>
              <div className="text-xs text-navy-500">2026-04-01</div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
