import { CodeBlock } from '@/components/CodeBlock';

export default function ExplorerPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card">
        <h1 className="text-lg font-semibold text-navy-800">Request builder</h1>
        <p className="mt-1 text-xs text-navy-500">
          Select an endpoint, fill in parameters, and send a live request.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-navy-500">Endpoint</label>
            <select className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
              <optgroup label="Matches">
                <option>GET /v1/matches</option>
                <option>GET /v1/matches/:id</option>
                <option>GET /v1/matches/:id/odds</option>
                <option>GET /v1/matches/:id/events</option>
              </optgroup>
              <optgroup label="Players">
                <option>GET /v1/players/:id</option>
                <option>GET /v1/players/:id/stats</option>
              </optgroup>
              <optgroup label="Standings">
                <option>GET /v1/standings</option>
              </optgroup>
              <optgroup label="Cricket">
                <option>GET /v1/cricket/matches</option>
                <option>GET /v1/cricket/matches/:id/scorecard</option>
              </optgroup>
              <optgroup label="Combat sports">
                <option>GET /v1/fight-cards</option>
                <option>GET /v1/bouts/:id</option>
                <option>GET /v1/athletes/:id</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-navy-500">Query parameters</label>
            <textarea
              className="mt-1 h-28 w-full rounded-lg border border-navy-200 px-3 py-2 font-mono text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder='{ "sport": "football", "fields": "scores,odds" }'
            />
          </div>

          <button className="btn-primary w-full">Send request</button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-navy-800">Response</h2>
        <p className="mt-1 text-xs text-navy-500">
          Live JSON response + meta breakdown + generated SDK code.
        </p>
        <div className="mt-6">
          <CodeBlock language="json">
{`{
  "data": { "scores": null },
  "meta": {
    "source": "none",
    "confidence": 0,
    "cached": false,
    "cache_age_ms": 0,
    "request_id": ""
  },
  "error": null
}`}
          </CodeBlock>
        </div>
      </div>
    </div>
  );
}
