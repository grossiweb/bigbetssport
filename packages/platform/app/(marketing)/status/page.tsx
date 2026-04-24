import { Badge } from '@/components/Badge';
import { Callout } from '@/components/Callout';

/**
 * Public status page. Real uptime history + incident log land in a follow-up
 * — this scaffold renders the final structure with static placeholder data.
 */

interface Component {
  readonly name: string;
  readonly status: 'operational' | 'degraded' | 'down' | 'maintenance';
  readonly note?: string;
}

const COMPONENTS: readonly Component[] = [
  { name: 'API Gateway',            status: 'operational' },
  { name: 'TheRundown Feed',        status: 'operational' },
  { name: 'NHL / MLB Data',         status: 'operational' },
  { name: 'Cricket Feed',           status: 'operational' },
  { name: 'MMA / Boxing Scrapers',  status: 'operational' },
  { name: 'WebSocket Server',       status: 'operational' },
  { name: 'Developer Dashboard',    status: 'operational' },
];

function statusBadge(s: Component['status']) {
  switch (s) {
    case 'operational': return <Badge color="green">Operational</Badge>;
    case 'degraded':    return <Badge color="amber">Degraded</Badge>;
    case 'down':        return <Badge color="red">Down</Badge>;
    case 'maintenance': return <Badge color="grey">Maintenance</Badge>;
  }
}

function uptimeBar(days: number = 90) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: days }, (_, i) => {
        // Deterministic "mostly green" pattern using the index — real data
        // comes from an incidents aggregation query in a follow-up.
        const hash = (i * 2654435761) >>> 0;
        const color =
          (hash % 90) === 0 ? 'bg-red-400' : (hash % 30) === 0 ? 'bg-amber-400' : 'bg-emerald-500';
        return <span key={i} className={`h-6 w-1 rounded-sm ${color}`} title={`Day -${days - i}`} />;
      })}
    </div>
  );
}

export default function StatusPage() {
  const allOperational = COMPONENTS.every((c) => c.status === 'operational');
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold text-navy-800">System status</h1>
      <p className="mb-6 text-sm text-navy-500">Real-time platform health.</p>

      {allOperational ? (
        <Callout type="info">
          <span className="font-semibold">All systems operational</span> — no
          open incidents.
        </Callout>
      ) : (
        <Callout type="warning">
          <span className="font-semibold">Partial service disruption</span> —
          see components below.
        </Callout>
      )}

      <div className="mt-10 overflow-hidden rounded-xl border border-navy-100 bg-white shadow-card">
        <div className="border-b border-navy-100 bg-navy-50 px-5 py-3 text-sm font-semibold text-navy-700">
          Components
        </div>
        <div className="divide-y divide-navy-100">
          {COMPONENTS.map((c) => (
            <div key={c.name} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-navy-800">{c.name}</div>
                {c.note && <div className="text-xs text-navy-500">{c.note}</div>}
              </div>
              <div className="flex items-center gap-5">
                {uptimeBar()}
                {statusBadge(c.status)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-semibold text-navy-800">Incident history</h2>
        <p className="text-sm text-navy-500">
          No incidents in the last 90 days. Full incident log will populate as
          events occur.
        </p>
      </section>

      <section className="mt-10 rounded-xl border border-navy-100 bg-navy-50 p-6">
        <h3 className="text-base font-semibold text-navy-800">Get notified about incidents</h3>
        <p className="mt-1 text-sm text-navy-500">
          Subscribe and we'll email you when the status of any component changes.
        </p>
        <form className="mt-4 flex max-w-md gap-2">
          <input
            type="email"
            placeholder="you@company.com"
            className="flex-1 rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button className="btn-primary">Subscribe</button>
        </form>
      </section>
    </div>
  );
}
