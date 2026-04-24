import Link from 'next/link';
import { Button } from '../Button';
import { CodeBlock } from '../CodeBlock';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-navy-100 bg-gradient-to-b from-navy-800 to-navy-900 py-24 text-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-50 ring-1 ring-inset ring-brand-600/30">
            Early access
          </p>
          <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Sports matches, odds &amp;
            <br />
            <span className="text-brand-500">boxscores in one REST API</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-navy-100">
            Matches + odds across 11 major leagues (NBA, NFL, MLB, NHL, EPL &amp;
            the top European soccer divisions). Standings, player rosters,
            team + player boxscores, scoring plays — all through one consistent
            JSON envelope.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="lg">Get API key — free</Button>
            </Link>
            <Link href="/docs/introduction">
              <Button size="lg" variant="secondary">
                Read the docs
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-navy-200">
            No credit card. The full <code className="rounded bg-white/10 px-1">/v1/stored/*</code> surface is open on the free plan.
          </p>
        </div>
        <div>
          <CodeBlock language="bash" title="curl — list today's NBA matches">
{`curl 'https://bbsgateway-production.up.railway.app/v1/stored/matches?sport=basketball&limit=2'

# Response (abbreviated):
{
  "data": [
    {
      "id": "0c45aa04-95d4-4998-a16e-32b833e48727",
      "sport": "basketball",
      "league": "NBA",
      "home": {
        "name": "Oklahoma City Thunder",
        "logo_url": "https://r2.thesportsdb.com/.../okc.png"
      },
      "away": { "name": "Phoenix Suns" },
      "kickoff_utc": "2026-04-23T01:30:00.000Z",
      "status": "finished",
      "score": { "home": 120, "away": 107 },
      "linescore": { "home": [30,35,35,20], "away": [29,28,20,30] }
    }
  ],
  "pagination": { "total": 6, "limit": 2, "offset": 0 }
}`}
          </CodeBlock>
        </div>
      </div>
    </section>
  );
}
