import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { PricingCards } from '@/components/marketing/PricingCards';
import { CodeBlock } from '@/components/CodeBlock';
import { Badge } from '@/components/Badge';

type Coverage = 'full' | 'partial' | 'paid' | 'none';

interface CoverageRow {
  readonly sport: string;
  readonly scores: Coverage;
  readonly odds: Coverage;
  readonly lineups: Coverage;
  readonly stats: Coverage;
  readonly historical: Coverage;
  readonly xg: Coverage;
  readonly injuries: Coverage;
}

const COVERAGE: readonly CoverageRow[] = [
  { sport: 'Football',         scores: 'full',    odds: 'partial', lineups: 'full',    stats: 'full',    historical: 'full', xg: 'paid',    injuries: 'full'    },
  { sport: 'Basketball (NBA)', scores: 'full',    odds: 'partial', lineups: 'full',    stats: 'full',    historical: 'full', xg: 'none',    injuries: 'full'    },
  { sport: 'Baseball (MLB)',   scores: 'full',    odds: 'partial', lineups: 'full',    stats: 'full',    historical: 'full', xg: 'none',    injuries: 'partial' },
  { sport: 'Ice Hockey (NHL)', scores: 'full',    odds: 'partial', lineups: 'full',    stats: 'full',    historical: 'full', xg: 'none',    injuries: 'partial' },
  { sport: 'Cricket',          scores: 'full',    odds: 'partial', lineups: 'partial', stats: 'full',    historical: 'partial', xg: 'none', injuries: 'partial' },
  { sport: 'MMA (UFC)',        scores: 'full',    odds: 'partial', lineups: 'none',    stats: 'partial', historical: 'full', xg: 'none',    injuries: 'none'    },
  { sport: 'Boxing',           scores: 'partial', odds: 'partial', lineups: 'none',    stats: 'partial', historical: 'partial', xg: 'none', injuries: 'none'    },
  { sport: 'Formula 1',        scores: 'full',    odds: 'partial', lineups: 'none',    stats: 'partial', historical: 'full', xg: 'none',    injuries: 'none'    },
  { sport: 'NFL',              scores: 'full',    odds: 'partial', lineups: 'partial', stats: 'partial', historical: 'partial', xg: 'none', injuries: 'partial' },
  { sport: 'Rugby',            scores: 'partial', odds: 'none',    lineups: 'none',    stats: 'none',    historical: 'partial', xg: 'none', injuries: 'none'    },
];

function coverageCell(c: Coverage) {
  switch (c) {
    case 'full':    return <span className="text-emerald-600">✓</span>;
    case 'partial': return <Badge color="amber">Partial</Badge>;
    case 'paid':    return <Badge color="grey">🔒 Paid</Badge>;
    case 'none':    return <span className="text-navy-300">—</span>;
  }
}

export default function MarketingHome() {
  return (
    <>
      <Hero />
      <section className="border-y border-navy-100 bg-navy-50 py-8">
        <div className="mx-auto max-w-7xl px-6 text-center text-sm text-navy-500">
          Trusted by 1,200+ developers at companies like{' '}
          <span className="font-semibold text-navy-400">FantasyHub</span> ·{' '}
          <span className="font-semibold text-navy-400">OddsFox</span> ·{' '}
          <span className="font-semibold text-navy-400">ScoutBoard</span> ·{' '}
          <span className="font-semibold text-navy-400">BetMetrics</span>
        </div>
      </section>

      <FeatureGrid />

      {/* Code sample tabs (TypeScript first — full tabbed UI deferred). */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
            Integrate in 3 lines
          </h2>
          <p className="mt-3 text-navy-500">
            Use the official SDK or hit the REST API directly. Every response
            is the same envelope.
          </p>
        </div>
        <CodeBlock language="typescript" title="Node.js — @bigballsports/sdk">
{`import { BigBallSportsClient } from '@bigballsports/sdk';

const client = new BigBallSportsClient('bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

// Today's live Premier League matches with real-time scores + odds
const matches = await client.matches.list({ sport: 'football' });
for (const m of matches.data) {
  console.log(m.scores?.value, 'confidence:', m.scores?.confidence);
}`}
        </CodeBlock>
      </section>

      {/* Sports coverage */}
      <section className="border-y border-navy-100 bg-navy-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
              Sports coverage, honestly
            </h2>
            <p className="mt-3 text-navy-500">
              Nothing to hide. Here's exactly what's available for each sport
              on the free plan, and what requires upgrading.
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Sport</th>
                  <th className="px-4 py-3 font-medium">Scores</th>
                  <th className="px-4 py-3 font-medium">Odds</th>
                  <th className="px-4 py-3 font-medium">Lineups</th>
                  <th className="px-4 py-3 font-medium">Stats</th>
                  <th className="px-4 py-3 font-medium">Historical</th>
                  <th className="px-4 py-3 font-medium">xG</th>
                  <th className="px-4 py-3 font-medium">Injuries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {COVERAGE.map((row) => (
                  <tr key={row.sport}>
                    <td className="px-4 py-3 font-medium text-navy-800">{row.sport}</td>
                    <td className="px-4 py-3">{coverageCell(row.scores)}</td>
                    <td className="px-4 py-3">{coverageCell(row.odds)}</td>
                    <td className="px-4 py-3">{coverageCell(row.lineups)}</td>
                    <td className="px-4 py-3">{coverageCell(row.stats)}</td>
                    <td className="px-4 py-3">{coverageCell(row.historical)}</td>
                    <td className="px-4 py-3">{coverageCell(row.xg)}</td>
                    <td className="px-4 py-3">{coverageCell(row.injuries)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-navy-500">
            xG is paid-only (Sportmonks Starter+). Odds carry a 5-minute delay
            on free/starter plans. NBA source is unofficial — expect occasional
            blocks (circuit breaker handles this).
          </p>
        </div>
      </section>

      <PricingCards />
    </>
  );
}
