import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';

/**
 * 5-step quickstart. Rendered as static content now; interactive run-in-
 * browser for each step (with auto-advance on success) ships in a follow-up
 * alongside the API Explorer Server-Sent-Events wiring.
 */

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
        Five steps. Five minutes. Working API response in your terminal.
      </p>

      <Step n={1} title="Get your API key">
        <p>
          Sign in and head to{' '}
          <a href="/dashboard/keys" className="text-brand-700 hover:underline">
            /dashboard/keys
          </a>
          . Click <strong>Create API key</strong>, pick <em>Live</em>, keep the
          default scopes. Copy the key — you will only see it once.
        </p>
        <Callout type="warning">
          Keys are only shown in full at creation time. Store them in a
          password manager or environment file; never commit them to git.
        </Callout>
      </Step>

      <Step n={2} title="Make your first request">
        <p>
          Your key is already active. List the 11 supported sports:
        </p>
        <CodeBlock language="bash">
{`curl https://api.bigballsports.io/v1/sports \\
  -H "Authorization: Bearer bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`}
        </CodeBlock>
        <p>
          Every response contains a <code>data</code>, <code>meta</code>, and
          <code> error</code> field. See{' '}
          <a href="/docs/response-envelope" className="text-brand-700 hover:underline">
            the envelope spec
          </a>.
        </p>
      </Step>

      <Step n={3} title="Fetch live matches">
        <CodeBlock language="bash">
{`curl "https://api.bigballsports.io/v1/matches?sport=football&status=live&limit=3" \\
  -H "Authorization: Bearer bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`}
        </CodeBlock>
        <p>
          Inspect <code>meta.confidence</code> and <code>meta.cached</code>{' '}
          in the response — every request tells you where the data came from
          and how fresh it is.
        </p>
      </Step>

      <Step n={4} title="Install the SDK">
        <CodeBlock language="bash" title="Node.js">
{`npm install @bigballsports/sdk`}
        </CodeBlock>
        <CodeBlock language="typescript" title="Use the SDK">
{`import { BigBallSportsClient } from '@bigballsports/sdk';

const client = new BigBallSportsClient('bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
const { data } = await client.matches.list({ sport: 'football', status: 'live' });
console.log(data);`}
        </CodeBlock>
      </Step>

      <Step n={5} title="Subscribe to live updates (Pro)">
        <p>
          WebSocket subscriptions require the Pro plan. On any lower plan,
          the SDK throws a <code>PlanError</code>. Upgrade at{' '}
          <a href="/dashboard/billing" className="text-brand-700 hover:underline">
            /dashboard/billing
          </a>.
        </p>
        <CodeBlock language="typescript" title="Live score stream">
{`import { BigBallSportsClient } from '@bigballsports/sdk';
import { io } from 'socket.io-client';

const client = new BigBallSportsClient('bbs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
const unsubscribe = client.subscribe(
  'sport:football',
  (event) => console.log(event.type, event.data),
  { socketIo: io },
);`}
        </CodeBlock>
      </Step>

      <div className="mt-12 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="text-lg font-semibold text-emerald-900">🎉 You're all set</h3>
        <p className="mt-2 text-sm text-emerald-800">
          Keep exploring: try{' '}
          <a href="/dashboard/explorer" className="underline">the API Explorer</a>,
          {' '}
          <a href="/docs/webhooks" className="underline">set up a webhook</a>, or
          {' '}
          <a href="/docs/matches" className="underline">read the full API reference</a>.
        </p>
      </div>
    </div>
  );
}
