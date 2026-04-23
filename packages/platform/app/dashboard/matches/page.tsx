import Link from 'next/link';
import { listMatches, listAvailableSports, countMatches } from '@/lib/matches';
import { Badge } from '@/components/Badge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /dashboard/matches — ingested sports data browser.
 * Reads rows populated by `packages/orchestrator/scripts/ingest-rundown.ts`.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { sport?: string; status?: string };
}) {
  const sport = typeof searchParams.sport === 'string' ? searchParams.sport : undefined;
  const status = typeof searchParams.status === 'string' ? searchParams.status : undefined;

  let matches = [] as Awaited<ReturnType<typeof listMatches>>;
  let available = [] as Awaited<ReturnType<typeof listAvailableSports>>;
  let total = 0;
  let dbError: string | null = null;
  try {
    [matches, available, total] = await Promise.all([
      listMatches({ sport, status, limit: 100 }),
      listAvailableSports(),
      countMatches({ sport, status }),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Matches</h1>
        <p className="mt-1 text-sm text-navy-500">
          Live data ingested from The Rundown. Every ingest run upserts matches
          and appends a new row to the odds time-series.
        </p>
      </div>

      {dbError && (
        <div className="card border-red-200 bg-red-50 text-sm text-red-800">
          Could not reach the database: {dbError}
        </div>
      )}

      {/* Filter pills */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-navy-500">
            Sport
          </span>
          <Pill href="/dashboard/matches" active={!sport}>
            All ({available.reduce((n, s) => n + s.count, 0)})
          </Pill>
          {available.map((s) => (
            <Pill
              key={s.sportType}
              href={`/dashboard/matches?sport=${s.sportType}`}
              active={sport === s.sportType}
            >
              {prettySport(s.sportType)} ({s.count})
            </Pill>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-navy-500">
            Status
          </span>
          {(['scheduled', 'live', 'finished'] as const).map((s) => (
            <Pill
              key={s}
              href={buildUrl({ sport, status: status === s ? undefined : s })}
              active={status === s}
            >
              {s}
            </Pill>
          ))}
        </div>
      </div>

      {/* Match list */}
      <div className="card p-0 overflow-hidden">
        {matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="text-sm font-medium text-navy-800">No matches yet</div>
            <p className="mt-1 max-w-md text-xs text-navy-500">
              Run{' '}
              <code className="rounded bg-navy-100 px-1 py-0.5">
                pnpm --filter @bbs/orchestrator ingest:rundown
              </code>{' '}
              on the server to populate the database. The scheduler will run this
              automatically once the orchestrator is deployed to Railway.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-navy-100">
            <div className="flex items-center justify-between border-b border-navy-100 px-4 py-2 text-xs text-navy-500">
              <span>
                Showing {matches.length} of {total} match{total === 1 ? '' : 'es'}
              </span>
              <span>Sorted by kickoff</span>
            </div>
            {matches.map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/matches/${m.id}`}
                className="flex items-center gap-4 px-4 py-3 transition hover:bg-navy-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-navy-500">
                    <span>{prettySport(m.sportType)}</span>
                    {m.leagueName && <span>· {m.leagueName}</span>}
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm font-medium text-navy-800">
                    <TeamBadge name={m.away} logoUrl={m.awayLogoUrl} />
                    <span className="text-navy-400">@</span>
                    <TeamBadge name={m.home} logoUrl={m.homeLogoUrl} />
                  </div>
                  <div className="mt-0.5 text-xs text-navy-500">
                    {formatDate(m.kickoffUtc)} UTC
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {m.homeScore !== null && m.awayScore !== null ? (
                    <div className="text-lg font-semibold tabular-nums text-navy-800">
                      {m.awayScore} – {m.homeScore}
                    </div>
                  ) : (
                    <div className="text-xs text-navy-400">no score yet</div>
                  )}
                  <div className="text-[11px] text-navy-500">
                    {m.oddsCount} odds rows
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamBadge({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="h-5 w-5 rounded-sm object-contain"
          loading="lazy"
        />
      ) : (
        <span className="h-5 w-5 rounded-sm bg-navy-100" />
      )}
      <span>{name}</span>
    </span>
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

function StatusBadge({ status }: { status: string }) {
  if (status === 'live')
    return <Badge color="red">live</Badge>;
  if (status === 'finished')
    return <Badge color="grey">finished</Badge>;
  return <Badge color="blue">scheduled</Badge>;
}

function prettySport(slug: string): string {
  return slug
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function buildUrl(q: { sport?: string; status?: string }): string {
  const params = new URLSearchParams();
  if (q.sport) params.set('sport', q.sport);
  if (q.status) params.set('status', q.status);
  const s = params.toString();
  return s ? `/dashboard/matches?${s}` : '/dashboard/matches';
}
