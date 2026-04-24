import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';

export default function IntroductionPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-navy-800">Introduction</h1>
      <p className="mt-3 text-navy-600">
        Big Ball Sports serves a unified sports data API backed by Postgres.
        We ingest matches, odds, standings, rosters, team + player boxscores,
        and scoring plays from public sources on a scheduled cadence and expose
        them through a consistent JSON shape.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">What you get</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-600">
        <li>
          Matches + odds across 11 leagues — NFL, NBA, MLB, NHL, EPL, La Liga,
          Bundesliga, Serie A, Ligue 1, MLS, NCAAF
        </li>
        <li>Season standings (W / L / T / PCT / streak) per team</li>
        <li>Team + player boxscores for finished games</li>
        <li>Player rosters with positions, jersey numbers, headshots</li>
        <li>Team logos, venue names, attendance, broadcast</li>
        <li>Linescore (per quarter / inning / period) and scoring-play timelines</li>
        <li>One response envelope across every endpoint</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">Data sources</h2>
      <p className="mt-3 text-navy-600">
        Current ingestion layer runs on public endpoints with no paid licences:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-600">
        <li><strong>The Rundown</strong> — matches, scores, main-line odds, per-period scoring</li>
        <li><strong>ESPN public API</strong> — standings, boxscores, player stats, play-by-play, attendance</li>
        <li><strong>TheSportsDB</strong> — team logos, venue metadata, player rosters + headshots</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">Response envelope</h2>
      <p className="mt-3 text-navy-600">
        Every response — success or error — uses this envelope:
      </p>
      <CodeBlock language="json">
{`{
  "data": { /* the resource you requested */ },
  "pagination": { "total": 240, "limit": 50, "offset": 0 },
  "error": null
}`}
      </CodeBlock>

      <h2 className="mt-10 text-xl font-semibold text-navy-800">Next steps</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-navy-600">
        <li><a href="/docs/quickstart" className="text-brand-700 hover:underline">Run the 5-minute Quickstart</a></li>
      </ul>

      <div className="mt-10">
        <Callout type="info">
          The platform is under active development. Features like WebSocket
          subscriptions, GraphQL, and HMAC-signed webhooks are on the roadmap
          but not yet live — the docs only describe what actually ships today.
        </Callout>
      </div>
    </div>
  );
}
