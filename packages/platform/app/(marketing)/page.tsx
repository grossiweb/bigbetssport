import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { PricingCards } from '@/components/marketing/PricingCards';
import { CodeBlock } from '@/components/CodeBlock';
import { Badge } from '@/components/Badge';

type Coverage = 'full' | 'partial' | 'none';

interface CoverageRow {
  readonly sport: string;
  readonly matches: Coverage;
  readonly odds: Coverage;
  readonly standings: Coverage;
  readonly teamStats: Coverage;
  readonly playerStats: Coverage;
  readonly rosters: Coverage;
  readonly logos: Coverage;
}

/**
 * Coverage reflects what is currently ingested and served from /v1/stored/*.
 * Updated as new leagues / fields come online.
 */
const COVERAGE: readonly CoverageRow[] = [
  { sport: 'NBA',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'full',    playerStats: 'full',    rosters: 'full',    logos: 'full' },
  { sport: 'NFL',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'partial', playerStats: 'partial', rosters: 'full',    logos: 'full' },
  { sport: 'MLB',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'full',    playerStats: 'full',    rosters: 'full',    logos: 'full' },
  { sport: 'NHL',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'full',    playerStats: 'full',    rosters: 'full',    logos: 'full' },
  { sport: 'NCAAF',      matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'partial', playerStats: 'partial', rosters: 'partial', logos: 'partial' },
  { sport: 'EPL',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'full',    logos: 'full' },
  { sport: 'La Liga',    matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'full',    logos: 'full' },
  { sport: 'Bundesliga', matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'full',    logos: 'full' },
  { sport: 'Serie A',    matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'full',    logos: 'full' },
  { sport: 'Ligue 1',    matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'full',    logos: 'full' },
  { sport: 'MLS',        matches: 'full',    odds: 'full',    standings: 'full', teamStats: 'none',    playerStats: 'none',    rosters: 'partial', logos: 'partial' },
];

function coverageCell(c: Coverage) {
  switch (c) {
    case 'full':    return <span className="text-emerald-600">✓</span>;
    case 'partial': return <Badge color="amber">Partial</Badge>;
    case 'none':    return <span className="text-navy-300">—</span>;
  }
}

export default function MarketingHome() {
  return (
    <>
      <Hero />

      <FeatureGrid />

      {/* Code sample */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
            Three lines to a match feed
          </h2>
          <p className="mt-3 text-navy-500">
            Hit the REST API directly with fetch. Every response is the same envelope.
          </p>
        </div>
        <CodeBlock language="typescript" title="Node.js — REST">
{`// List today's NBA matches with logos + scores + odds counts.
const res = await fetch(
  'https://bbsgateway-production.up.railway.app/v1/stored/matches?sport=basketball&limit=10',
);
const { data } = await res.json();
for (const m of data) {
  console.log(\`\${m.away.name} @ \${m.home.name}\`, m.score, m.odds_count, 'odds rows');
}`}
        </CodeBlock>
      </section>

      {/* Sports coverage */}
      <section className="border-y border-navy-100 bg-navy-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
              Coverage, honestly
            </h2>
            <p className="mt-3 text-navy-500">
              This table is generated from what is live in production right now.
              Green means you can hit the endpoint today and get real data;
              amber means partial coverage; dash means not yet wired.
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-medium">League</th>
                  <th className="px-4 py-3 font-medium">Matches</th>
                  <th className="px-4 py-3 font-medium">Odds</th>
                  <th className="px-4 py-3 font-medium">Standings</th>
                  <th className="px-4 py-3 font-medium">Team stats</th>
                  <th className="px-4 py-3 font-medium">Player stats</th>
                  <th className="px-4 py-3 font-medium">Rosters</th>
                  <th className="px-4 py-3 font-medium">Logos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {COVERAGE.map((row) => (
                  <tr key={row.sport}>
                    <td className="px-4 py-3 font-medium text-navy-800">{row.sport}</td>
                    <td className="px-4 py-3">{coverageCell(row.matches)}</td>
                    <td className="px-4 py-3">{coverageCell(row.odds)}</td>
                    <td className="px-4 py-3">{coverageCell(row.standings)}</td>
                    <td className="px-4 py-3">{coverageCell(row.teamStats)}</td>
                    <td className="px-4 py-3">{coverageCell(row.playerStats)}</td>
                    <td className="px-4 py-3">{coverageCell(row.rosters)}</td>
                    <td className="px-4 py-3">{coverageCell(row.logos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-navy-500">
            Player / team stats require finished games — upcoming matches show
            scores and odds only. Soccer boxscores are on the roadmap (ESPN
            uses a different response shape for soccer).
          </p>
        </div>
      </section>

      <PricingCards />
    </>
  );
}
