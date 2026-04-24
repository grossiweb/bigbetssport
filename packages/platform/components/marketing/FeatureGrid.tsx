const FEATURES = [
  {
    title: 'Matches, odds, and linescores',
    body:
      'NFL, NBA, MLB, NHL, EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS — ingested daily with main-line odds, scores, and per-period breakdowns.',
  },
  {
    title: 'Team stats + player boxscores',
    body:
      'Boxscore-level stats for every finished game: field goals, rebounds, hits, errors, shots on goal. Per-player with positions and headshots.',
  },
  {
    title: 'Season standings',
    body:
      'Current-season W/L records, win percentage, and streaks across 11 leagues — refreshed from league official data.',
  },
  {
    title: 'Free tier, no card needed',
    body:
      'Sign up with an email; get a read-only key in under 30 seconds. The full /v1/stored/* surface is open on the free plan.',
  },
  {
    title: 'Scoring plays timeline',
    body:
      'Every scoring event with period, clock, description, and running score — reconstructed from league play-by-play feeds.',
  },
  {
    title: 'Team logos + player headshots',
    body:
      '73% of teams carry official badges; 99% of active players have a headshot — no more hunting down assets.',
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
          One REST API, one response envelope, one predictable JSON shape across
          every sport. Every field carries its source.
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
