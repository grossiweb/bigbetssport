import Link from 'next/link';
import { listPlayers, countPlayers, listPlayerSports } from '@/lib/players';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: { sport?: string; q?: string };
}) {
  const sport = typeof searchParams.sport === 'string' ? searchParams.sport : undefined;
  const search = typeof searchParams.q === 'string' ? searchParams.q : undefined;

  let players: Awaited<ReturnType<typeof listPlayers>> = [];
  let sports: Awaited<ReturnType<typeof listPlayerSports>> = [];
  let total = 0;
  let dbError: string | null = null;
  try {
    [players, sports, total] = await Promise.all([
      listPlayers({ sport, search, limit: 60 }),
      listPlayerSports(),
      countPlayers({ sport, search }),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Players</h1>
        <p className="mt-1 text-sm text-navy-500">
          Rosters across {sports.length} sport{sports.length === 1 ? '' : 's'} — headshots, positions, heights, weights. Source: TheSportsDB.
        </p>
      </div>

      {dbError && (
        <div className="card border-red-200 bg-red-50 text-sm text-red-800">
          Could not reach the database: {dbError}
        </div>
      )}

      <form className="card flex flex-wrap items-center gap-2" action="/dashboard/players">
        <input
          name="q"
          defaultValue={search ?? ''}
          placeholder="Search by name…"
          className="flex-1 min-w-0 rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {sport && <input type="hidden" name="sport" value={sport} />}
        <button
          type="submit"
          className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-900"
        >
          Search
        </button>
      </form>

      {sports.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-navy-500">Sport</span>
            <Pill
              href={`/dashboard/players${search ? `?q=${encodeURIComponent(search)}` : ''}`}
              active={!sport}
            >
              All ({sports.reduce((n, s) => n + s.count, 0)})
            </Pill>
            {sports.map((s) => (
              <Pill
                key={s.sport}
                href={`/dashboard/players?sport=${encodeURIComponent(s.sport)}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                active={sport === s.sport}
              >
                {prettySport(s.sport)} ({s.count})
              </Pill>
            ))}
          </div>
        </div>
      )}

      {players.length === 0 ? (
        <div className="card text-sm text-navy-500">
          No players yet. Run{' '}
          <code className="rounded bg-navy-100 px-1 py-0.5">
            pnpm --filter @bbs/orchestrator ingest:players
          </code>{' '}
          to populate.
        </div>
      ) : (
        <>
          <div className="text-xs text-navy-500">
            Showing {players.length} of {total} player{total === 1 ? '' : 's'}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((p) => (
              <div key={p.id} className="card flex gap-3 p-3">
                {p.headshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.headshotUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg object-cover bg-navy-50"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-16 w-16 shrink-0 rounded-lg bg-navy-100" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-sm font-semibold text-navy-800 truncate">
                    {p.jerseyNumber && (
                      <span className="rounded bg-navy-100 px-1.5 py-0.5 text-[11px] font-medium text-navy-700">
                        #{p.jerseyNumber}
                      </span>
                    )}
                    <span className="truncate">{p.name}</span>
                  </div>
                  {p.teamName && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-navy-500">
                      {p.teamLogoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.teamLogoUrl} alt="" className="h-3 w-3 object-contain" />
                      )}
                      <span className="truncate">{p.teamName}</span>
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-navy-500">
                    {p.position && <span>{p.position}</span>}
                    {p.nationality && <span>· {p.nationality}</span>}
                    {p.height && <span>· {p.height}</span>}
                    {p.weight && <span>· {p.weight}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
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
