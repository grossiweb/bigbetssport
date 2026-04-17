import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';

export default function IntroductionPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-navy-800">Introduction</h1>
      <p className="mt-3 text-navy-600">
        Big Ball Sports is a unified sports data API. It aggregates 20+
        free-tier sports data sources, fills coverage gaps via a fleet of
        MCP scrapers, and serves the result through a single Stripe-style
        HTTPS + WebSocket + GraphQL gateway.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">What you get</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-600">
        <li>Real-time scores, odds, lineups, and stats for 11 sports</li>
        <li>The same response envelope across every endpoint</li>
        <li>Per-field confidence scores (0.95 official → 0.60 MCP)</li>
        <li>WebSocket subscriptions on Pro plan</li>
        <li>HMAC-signed webhook delivery with exponential retry</li>
        <li>Zero-dependency TypeScript SDK (Python + Go coming)</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">Response envelope</h2>
      <p className="mt-3 text-navy-600">
        Every response — success or error — uses this envelope:
      </p>
      <CodeBlock language="json">
{`{
  "data": { /* the resource you requested */ },
  "meta": {
    "source":        "nhl-api",
    "confidence":    0.95,
    "cached":        false,
    "cache_age_ms":  0,
    "request_id":    "c2f1c4d0-…"
  },
  "error": null
}`}
      </CodeBlock>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">Next steps</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-600">
        <li><a href="/docs/quickstart" className="text-brand-700 hover:underline">Run the 5-minute Quickstart</a></li>
        <li><a href="/docs/authentication" className="text-brand-700 hover:underline">Authenticate your requests</a></li>
        <li><a href="/docs/matches" className="text-brand-700 hover:underline">Explore the /v1/matches endpoints</a></li>
      </ul>

      <div className="mt-10">
        <Callout type="info">
          Most of the documentation site is scaffolded. Full MDX pages (every
          endpoint, every sport, every SDK) populate in a follow-up prompt —
          the layout, typography, and navigation are production-ready today.
        </Callout>
      </div>
    </div>
  );
}
