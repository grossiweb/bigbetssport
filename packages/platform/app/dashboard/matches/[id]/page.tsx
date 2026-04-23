import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatchById, listLatestOdds } from '@/lib/matches';
import { Badge } from '@/components/Badge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MatchDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let match: Awaited<ReturnType<typeof getMatchById>> = null;
  let odds: Awaited<ReturnType<typeof listLatestOdds>> = [];
  try {
    match = await getMatchById(params.id);
    if (match) odds = await listLatestOdds(params.id);
  } catch {
    // render with nulls below
  }
  if (!match) notFound();

  // Group odds by market
  const byMarket = new Map<string, typeof odds>();
  for (const o of odds) {
    const bucket = byMarket.get(o.market) ?? [];
    bucket.push(o);
    byMarket.set(o.market, bucket);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/matches"
          className="text-xs text-brand-700 hover:underline"
        >
          ← Back to matches
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-navy-800">
          {match.away} <span className="text-navy-400">@</span> {match.home}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-navy-500">
          <span>{prettySport(match.sportType)}</span>
          {match.leagueName && <span>· {match.leagueName}</span>}
          <span>· kickoff {match.kickoffUtc.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
          <StatusBadge status={match.status} />
        </div>
      </div>

      {match.homeScore !== null && match.awayScore !== null && (
        <div className="card flex items-baseline gap-6">
          <div className="text-center">
            <div className="text-xs text-navy-500">{match.away}</div>
            <div className="text-4xl font-bold tabular-nums text-navy-800">
              {match.awayScore}
            </div>
          </div>
          <div className="text-navy-300">—</div>
          <div className="text-center">
            <div className="text-xs text-navy-500">{match.home}</div>
            <div className="text-4xl font-bold tabular-nums text-navy-800">
              {match.homeScore}
            </div>
          </div>
          <div className="ml-auto text-xs text-navy-500">
            Source: <code className="rounded bg-navy-100 px-1 py-0.5">therundown</code>
          </div>
        </div>
      )}

      {byMarket.size === 0 ? (
        <div className="card text-sm text-navy-500">
          No odds stored yet for this match.
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(byMarket.entries()).map(([market, rows]) => (
            <div key={market} className="card">
              <h2 className="mb-3 text-sm font-semibold capitalize text-navy-800">
                {market}
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-navy-500">
                      <th className="pb-2 pr-4">Sportsbook</th>
                      <th className="pb-2 pr-4">Selection</th>
                      <th className="pb-2 pr-4 text-right">Line</th>
                      <th className="pb-2 pr-4 text-right">Price</th>
                      <th className="pb-2 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-4 font-mono text-xs text-navy-600">
                          {r.sportsbook.replace('rundown_book_', '')}
                        </td>
                        <td className="py-2 pr-4">{r.participant ?? '—'}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {r.value ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {r.price !== null ? formatPrice(r.price) : '—'}
                        </td>
                        <td className="py-2 text-right text-xs text-navy-500">
                          {timeAgo(r.fetchedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'live') return <Badge color="red">live</Badge>;
  if (status === 'finished') return <Badge color="grey">finished</Badge>;
  return <Badge color="blue">scheduled</Badge>;
}

function prettySport(slug: string): string {
  return slug.split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

function formatPrice(p: number): string {
  return p > 0 ? `+${p}` : String(p);
}

function timeAgo(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
