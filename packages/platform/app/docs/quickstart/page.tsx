import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';

const GATEWAY_URL = 'https://bbsgateway-production.up.railway.app';

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-navy-100 pt-8">
      <div className="flex items-baseline gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
          {n}
        </span>
        <h2 className="text-xl font-semibold text-navy-800">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-navy-600">{children}</div>
    </section>
  );
}

export default function QuickstartPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold text-navy-800">Quickstart</h1>
      <p className="mt-3 text-navy-600">
        Four steps to a working JSON response in your terminal. No auth needed
        during early access — the <code>/v1/stored/*</code> read surface is open.
      </p>

      <Step n={1} title="List the sports we cover">
        <CodeBlock language="bash">
{`curl ${GATEWAY_URL}/v1/stored/sports`}
        </CodeBlock>
        <p>
          Returns an array of <code>{`{sport, match_count}`}</code>. Use any of
          those slugs as the <code>sport</code> filter elsewhere.
        </p>
      </Step>

      <Step n={2} title="Fetch matches with logos + scores">
        <CodeBlock language="bash">
{`curl '${GATEWAY_URL}/v1/stored/matches?sport=basketball&limit=5'`}
        </CodeBlock>
        <p>
          Each match includes home / away team objects with{' '}
          <code>logo_url</code>, a <code>score</code> object, per-period{' '}
          <code>linescore</code>, <code>odds_count</code>, and ESPN /
          TheRundown external IDs for cross-referencing.
        </p>
      </Step>

      <Step n={3} title="Drill into a match's boxscore">
        <CodeBlock language="bash">
{`MATCH_ID="<id from step 2>"
curl "${GATEWAY_URL}/v1/stored/matches/$MATCH_ID/stats"`}
        </CodeBlock>
        <p>
          Returns <code>team_stats</code> (FG, FT, rebounds, assists, etc.)
          and <code>players</code> (each player's full stat line with
          headshot URL + jersey number + position).
        </p>
      </Step>

      <Step n={4} title="Get season standings">
        <CodeBlock language="bash">
{`curl '${GATEWAY_URL}/v1/stored/standings?league=NBA'`}
        </CodeBlock>
        <p>
          Each league returns a <code>rows</code> array sorted by rank, with W
          / L / T / PCT / games played / streak.
        </p>
      </Step>

      <Callout type="info">
        <strong>Paid plans (coming soon):</strong> per-key API enforcement,
        webhooks, WebSocket live feed, historical backfill. Current early-access
        keys will carry forward when those ship.
      </Callout>

      <div className="mt-12 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="text-lg font-semibold text-emerald-900">🎉 You're all set</h3>
        <p className="mt-2 text-sm text-emerald-800">
          Browse the data visually at{' '}
          <a href="/dashboard/matches" className="underline">/dashboard/matches</a>
          {', '}
          <a href="/dashboard/standings" className="underline">/dashboard/standings</a>
          {', or '}
          <a href="/dashboard/players" className="underline">/dashboard/players</a>.
        </p>
      </div>
    </div>
  );
}
