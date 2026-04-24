import Link from 'next/link';
import { Button } from '../Button';
import { CodeBlock } from '../CodeBlock';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-navy-100 bg-gradient-to-b from-navy-800 to-navy-900 py-24 text-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-50 ring-1 ring-inset ring-brand-600/30">
            v1.0 — production ready
          </p>
          <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
            The sports data API
            <br />
            <span className="text-brand-500">built for developers</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-navy-100">
            One API. 20+ sources. Real-time scores, odds, lineups, stats — for
            every sport. Stripe-grade reliability, with data confidence scores
            on every response.
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
            No credit card. 1,000 requests/day on the free plan.
          </p>
        </div>
        <div>
          <CodeBlock language="bash" title="curl — live EPL scores">
{`curl https://api.bigballsports.io/v1/matches \\
  -H "Authorization: Bearer bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -G \\
  --data-urlencode "league=epl" \\
  --data-urlencode "status=live"

# Response (abbreviated):
{
  "data": [
    {
      "id": "m_abc123",
      "home": "Arsenal",
      "away": "Chelsea",
      "scores": { "value": { "home": 2, "away": 1 }, "confidence": 0.95 }
    }
  ],
  "meta": { "source": "api-sports", "confidence": 0.95, "cached": false }
}`}
          </CodeBlock>
        </div>
      </div>
    </section>
  );
}
