const FEATURES = [
  {
    title: '20 data sources, 1 key',
    body:
      'NHL, MLB, NBA, FPL, TheRundown, Sportmonks — unified behind a single envelope. Never integrate a vendor directly again.',
  },
  {
    title: 'Real-time WebSocket feed',
    body:
      'socket.io rooms by sport, league, and match. Sub-50ms delivery for live scores and odds moves.',
  },
  {
    title: 'Cricket, MMA & Boxing',
    body:
      'Scorecards, innings state, fight cards, bout stats — with proper schemas for every sport.',
  },
  {
    title: 'Free tier, no card needed',
    body:
      '1,000 requests/day on the free plan. Sign up with GitHub; get a key in under 30 seconds.',
  },
  {
    title: 'Confidence scoring',
    body:
      'Every field ships with provenance: 0.95 for official league APIs, 0.85 for aggregators, 0.60 for MCP scrapers.',
  },
  {
    title: 'Gap-fill with MCP scrapers',
    body:
      'When an upstream times out or omits a field, 10 specialised scrapers (fbref, SofaScore, UFCStats, BoxRec) fill the gap.',
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-14 max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
          Built for the way developers actually work
        </h2>
        <p className="mt-3 text-navy-500">
          Every API call returns the same envelope. Every field carries
          provenance. Every source has a rate-limit and a circuit breaker.
          No surprises.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h3 className="text-lg font-semibold text-navy-800">{f.title}</h3>
            <p className="mt-2 text-sm text-navy-500">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
