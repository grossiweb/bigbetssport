import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatchById, listLatestOdds, listMatchEvents } from '@/lib/matches';
import { listLatestTeamStats, listPlayerStatsByMatch } from '@/lib/stats';
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
  let teamStats: Awaited<ReturnType<typeof listLatestTeamStats>> = [];
  let playerStats: Awaited<ReturnType<typeof listPlayerStatsByMatch>> = [];
  let scoringPlays: Awaited<ReturnType<typeof listMatchEvents>> = [];
  try {
    match = await getMatchById(params.id);
    if (match) {
      [odds, teamStats, playerStats, scoringPlays] = await Promise.all([
        listLatestOdds(params.id),
        listLatestTeamStats(params.id),
        listPlayerStatsByMatch(params.id),
        listMatchEvents(params.id, { scoringOnly: true, limit: 100 }),
      ]);
    }
  } catch {
    // render with nulls below
  }
  if (!match) notFound();

  // Group team stats by field so we can show home vs away side-by-side.
  const teamStatsByField = new Map<
    string,
    { label: string; home: string | null; away: string | null }
  >();
  for (const s of teamStats.filter((x) => x.source === 'espn')) {
    const row = teamStatsByField.get(s.field) ?? {
      label: s.label ?? s.field,
      home: null,
      away: null,
    };
    if (s.teamId === match.id) {
      // unused branch — teamId should never equal matchId
    }
    if (match && s.teamName === match.home) {
      row.home = s.displayValue;
    } else if (match && s.teamName === match.away) {
      row.away = s.displayValue;
    }
    teamStatsByField.set(s.field, row);
  }

  // Group player stats by team for the box score.
  const playersByTeam = new Map<string, typeof playerStats>();
  for (const p of playerStats) {
    const key = p.teamName ?? 'unassigned';
    const list = playersByTeam.get(key) ?? [];
    list.push(p);
    playersByTeam.set(key, list);
  }

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

      <div className="card flex items-center gap-6">
        <TeamPanel
          name={match.away}
          logoUrl={match.awayLogoUrl}
          score={match.awayScore}
        />
        <div className="text-2xl text-navy-300">—</div>
        <TeamPanel
          name={match.home}
          logoUrl={match.homeLogoUrl}
          score={match.homeScore}
        />
        <div className="ml-auto text-xs text-navy-500">
          Source: <code className="rounded bg-navy-100 px-1 py-0.5">therundown</code>
        </div>
      </div>

      {(match.attendance || match.broadcast) && (
        <div className="card flex flex-wrap gap-x-6 gap-y-2 text-xs text-navy-500">
          {match.attendance !== null && (
            <div>
              <span className="uppercase tracking-wide">Attendance:</span>{' '}
              <span className="font-medium text-navy-800 tabular-nums">
                {match.attendance.toLocaleString()}
              </span>
            </div>
          )}
          {match.broadcast && (
            <div>
              <span className="uppercase tracking-wide">Broadcast:</span>{' '}
              <span className="font-medium text-navy-800">{match.broadcast}</span>
            </div>
          )}
        </div>
      )}

      {match.linescore && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-navy-800">Linescore</h2>
          <div className="overflow-x-auto">
            <LinescoreTable
              home={match.home}
              away={match.away}
              homeScores={match.linescore.home}
              awayScores={match.linescore.away}
              homeTotal={match.homeScore}
              awayTotal={match.awayScore}
            />
          </div>
        </div>
      )}

      {scoringPlays.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-navy-100 bg-navy-50 px-4 py-2">
            <h2 className="text-sm font-semibold text-navy-800">Scoring plays</h2>
            <div className="text-[11px] text-navy-500">
              {scoringPlays.length} plays
            </div>
          </div>
          <ul className="divide-y divide-navy-100">
            {scoringPlays.map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-4 py-2">
                <div className="shrink-0 pt-0.5 text-[10px] font-medium uppercase text-navy-500 w-16">
                  {p.periodDisplay ?? (p.period ? `P${p.period}` : '—')}
                  {p.clock && <div className="text-navy-400 normal-case">{p.clock}</div>}
                </div>
                <div className="min-w-0 flex-1 text-sm text-navy-800">
                  {p.description ?? p.type ?? 'scoring play'}
                </div>
                <div className="shrink-0 text-right tabular-nums text-xs text-navy-600">
                  {p.awayScore !== null && p.homeScore !== null
                    ? `${p.awayScore}-${p.homeScore}`
                    : p.scoreValue !== null
                    ? `+${p.scoreValue}`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teamStatsByField.size > 0 && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-navy-800">Team stats</h2>
            <code className="rounded bg-navy-100 px-1.5 py-0.5 text-[11px] text-navy-600">espn</code>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-navy-500">
                  <th className="pb-2 text-right">{match.away}</th>
                  <th className="pb-2 px-4 text-center">Stat</th>
                  <th className="pb-2 text-left">{match.home}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {Array.from(teamStatsByField.entries()).map(([field, row]) => (
                  <tr key={field}>
                    <td className="py-1.5 text-right tabular-nums font-medium text-navy-800">
                      {row.away ?? '—'}
                    </td>
                    <td className="py-1.5 px-4 text-center text-xs text-navy-500">
                      {row.label}
                    </td>
                    <td className="py-1.5 text-left tabular-nums font-medium text-navy-800">
                      {row.home ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {playersByTeam.size > 0 && (
        <div className="space-y-4">
          {Array.from(playersByTeam.entries()).map(([teamName, roster]) => (
            <div key={teamName} className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-navy-100 bg-navy-50 px-4 py-2">
                <h2 className="text-sm font-semibold text-navy-800">
                  {teamName} · boxscore
                </h2>
                <div className="text-[11px] text-navy-500">
                  {roster.length} player{roster.length === 1 ? '' : 's'}
                </div>
              </div>
              <BoxScoreTable roster={roster} />
            </div>
          ))}
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

function TeamPanel({
  name,
  logoUrl,
  score,
}: {
  name: string;
  logoUrl: string | null;
  score: number | null;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="h-14 w-14 rounded-sm object-contain"
          loading="lazy"
        />
      ) : (
        <div className="h-14 w-14 rounded-sm bg-navy-100" />
      )}
      <div className="text-xs font-medium text-navy-500">{name}</div>
      <div className="text-4xl font-bold tabular-nums text-navy-800">
        {score ?? '–'}
      </div>
    </div>
  );
}

function LinescoreTable({
  home,
  away,
  homeScores,
  awayScores,
  homeTotal,
  awayTotal,
}: {
  home: string;
  away: string;
  homeScores: readonly number[];
  awayScores: readonly number[];
  homeTotal: number | null;
  awayTotal: number | null;
}) {
  const n = Math.max(homeScores.length, awayScores.length);
  const periods: number[] = [];
  for (let i = 1; i <= n; i += 1) periods.push(i);
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-navy-500">
          <th className="py-2 pr-4 text-left">Team</th>
          {periods.map((p) => (
            <th key={p} className="py-2 px-2 text-right">
              {p}
            </th>
          ))}
          <th className="py-2 pl-4 text-right">T</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-navy-100">
        <tr>
          <td className="py-2 pr-4 font-medium text-navy-800">{away}</td>
          {periods.map((p, i) => (
            <td key={p} className="py-2 px-2 text-right tabular-nums">
              {awayScores[i] ?? '—'}
            </td>
          ))}
          <td className="py-2 pl-4 text-right font-semibold tabular-nums">
            {awayTotal ?? '—'}
          </td>
        </tr>
        <tr>
          <td className="py-2 pr-4 font-medium text-navy-800">{home}</td>
          {periods.map((p, i) => (
            <td key={p} className="py-2 px-2 text-right tabular-nums">
              {homeScores[i] ?? '—'}
            </td>
          ))}
          <td className="py-2 pl-4 text-right font-semibold tabular-nums">
            {homeTotal ?? '—'}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function BoxScoreTable({
  roster,
}: {
  roster: Awaited<ReturnType<typeof listPlayerStatsByMatch>>;
}) {
  // Collect all distinct stat fields across players (union) + use labels.
  const fieldLabels = new Map<string, string>();
  for (const p of roster) {
    for (const [k, v] of Object.entries(p.stats)) {
      if (!fieldLabels.has(k)) fieldLabels.set(k, v.label ?? k);
    }
  }
  const fields = Array.from(fieldLabels.entries());
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wide text-navy-500">
            <th className="px-3 py-2">Player</th>
            {fields.map(([k, l]) => (
              <th key={k} className="px-2 py-2 text-right">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {roster.map((p) => (
            <tr key={p.playerId}>
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  {p.headshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.headshotUrl}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover bg-navy-100"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-navy-100" />
                  )}
                  <div>
                    <div className="font-medium text-navy-800">
                      {p.playerName}
                    </div>
                    {(p.jerseyNumber || p.position) && (
                      <div className="text-[10px] text-navy-500">
                        {p.jerseyNumber && `#${p.jerseyNumber}`}
                        {p.jerseyNumber && p.position && ' · '}
                        {p.position}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              {fields.map(([k]) => (
                <td key={k} className="px-2 py-1.5 text-right tabular-nums text-navy-700">
                  {p.stats[k]?.value ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
