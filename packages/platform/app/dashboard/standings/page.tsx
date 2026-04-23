import Link from 'next/link';
import { listStandingsByLeague, listStandingsLeagues } from '@/lib/standings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: { league?: string };
}) {
  const leagueName = typeof searchParams.league === 'string' ? searchParams.league : undefined;

  let groups = [] as Awaited<ReturnType<typeof listStandingsByLeague>>;
  let available = [] as Awaited<ReturnType<typeof listStandingsLeagues>>;
  let dbError: string | null = null;

  try {
    [groups, available] = await Promise.all([
      listStandingsByLeague({ leagueName }),
      listStandingsLeagues(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Standings</h1>
        <p className="mt-1 text-sm text-navy-500">
          Current season W/L records per league. Source: ESPN.
        </p>
      </div>

      {dbError && (
        <div className="card border-red-200 bg-red-50 text-sm text-red-800">
          Could not reach the database: {dbError}
        </div>
      )}

      {available.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-navy-500">
              League
            </span>
            <Pill href="/dashboard/standings" active={!leagueName}>
              All ({available.length})
            </Pill>
            {available.map((l) => (
              <Pill
                key={l.name}
                href={`/dashboard/standings?league=${encodeURIComponent(l.name)}`}
                active={leagueName === l.name}
              >
                {l.name} ({l.teamCount})
              </Pill>
            ))}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card text-sm text-navy-500">
          No standings ingested yet. Run{' '}
          <code className="rounded bg-navy-100 px-1 py-0.5">
            pnpm --filter @bbs/orchestrator ingest:standings
          </code>{' '}
          to populate.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.leagueId} className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-navy-100 bg-navy-50 px-4 py-2">
                <div>
                  <div className="text-sm font-semibold text-navy-800">
                    {g.leagueName}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-navy-500">
                    {prettySport(g.sportType)} · {g.season} · {g.rows.length} teams
                  </div>
                </div>
                <div className="text-[11px] text-navy-500">
                  updated {timeAgo(g.rows[0]?.updatedAt ?? new Date())}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-navy-500">
                      <th className="px-4 py-2 w-10">#</th>
                      <th className="py-2">Team</th>
                      <th className="py-2 text-right">W</th>
                      <th className="py-2 text-right">L</th>
                      <th className="py-2 text-right">T</th>
                      <th className="py-2 text-right">PCT</th>
                      <th className="py-2 text-right">GP</th>
                      <th className="px-4 py-2 text-right">Streak</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {g.rows.map((r) => (
                      <tr key={r.teamId}>
                        <td className="px-4 py-2 text-navy-500 tabular-nums">
                          {r.rank ?? '—'}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            {r.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.logoUrl}
                                alt=""
                                className="h-5 w-5 rounded-sm object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <span className="h-5 w-5 rounded-sm bg-navy-100" />
                            )}
                            <span className="font-medium text-navy-800">{r.teamName}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{r.wins ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{r.losses ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{r.ties ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">
                          {r.winPct !== null ? r.winPct.toFixed(3) : '—'}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {r.gamesPlayed ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-navy-600">
                          {r.streak ?? '—'}
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

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        'rounded-full px-3 py-1 text-xs font-medium transition ' +
        (active
          ? 'bg-navy-800 text-white'
          : 'bg-navy-100 text-navy-700 hover:bg-navy-200')
      }
    >
      {children}
    </Link>
  );
}

function prettySport(slug: string): string {
  return slug.split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
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
