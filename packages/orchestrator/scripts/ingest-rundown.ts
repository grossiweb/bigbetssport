/**
 * Rundown API → Postgres ingest.
 *
 * One-shot script (can be scheduled by Railway cron or re-run manually).
 * For each supported Rundown sport, fetches today's events + odds and
 * upserts them into `sports`, `leagues`, `teams`, `matches`, `odds`.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-rundown.ts [--date YYYY-MM-DD] [--sport nba|nfl|...|all]
 *
 * Env:
 *   DATABASE_URL          (required)  Postgres connection string
 *   RUNDOWN_API_KEY       (required)  Rundown free-tier key
 *   INGEST_DAYS           (optional)  number of days forward to ingest (default 1)
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://therundown.io/api/v2';
const AUTH_HEADER = 'X-TheRundown-Key';

// ---- Sport map: Rundown sport_id → (our sport_type, league_name) ----------
// These align with what seed-sports.ts inserts into `sports` + `leagues`.
interface SportMapping {
  readonly rundownSportId: number;
  readonly sportSlug: string;     // matches sports.slug
  readonly leagueName: string;    // matches leagues.name
}

const SPORT_MAP: readonly SportMapping[] = [
  { rundownSportId: 1,  sportSlug: 'american_football', leagueName: 'NCAAF' },
  { rundownSportId: 2,  sportSlug: 'american_football', leagueName: 'NFL' },
  { rundownSportId: 3,  sportSlug: 'baseball',          leagueName: 'MLB' },
  { rundownSportId: 4,  sportSlug: 'basketball',        leagueName: 'NBA' },
  { rundownSportId: 6,  sportSlug: 'ice_hockey',        leagueName: 'NHL' },
  { rundownSportId: 7,  sportSlug: 'mma',               leagueName: 'UFC' },
  { rundownSportId: 10, sportSlug: 'football',          leagueName: 'MLS' },
  { rundownSportId: 11, sportSlug: 'football',          leagueName: 'EPL' },
  { rundownSportId: 12, sportSlug: 'football',          leagueName: 'Ligue 1' },
  { rundownSportId: 13, sportSlug: 'football',          leagueName: 'Bundesliga' },
  { rundownSportId: 14, sportSlug: 'football',          leagueName: 'La Liga' },
  { rundownSportId: 15, sportSlug: 'football',          leagueName: 'Serie A' },
];

// ---- Rundown API response shapes (minimal subset) -------------------------
interface RundownScore {
  event_status?: string;
  score_home?: number;
  score_away?: number;
  venue_name?: string;
  venue_location?: string;
}

interface RundownTeam {
  team_id: number;
  name: string;
  mascot?: string;
  abbreviation?: string;
  is_home?: boolean;
  is_away?: boolean;
}

interface RundownParticipant {
  id: number;
  name: string;
  lines?: readonly RundownLine[];
}

interface RundownLine {
  value?: string;
  prices?: Record<string, RundownPrice>;
}

interface RundownPrice {
  price?: number;
  is_main_line?: boolean;
}

interface RundownMarket {
  market_id: number;
  name?: string;
  participants?: readonly RundownParticipant[];
}

interface RundownEvent {
  event_id: string;
  sport_id: number;
  event_date: string;
  score?: RundownScore;
  teams?: readonly RundownTeam[];
  markets?: readonly RundownMarket[];
}

interface RundownEventsResponse {
  events?: readonly RundownEvent[];
}

// ---- Status mapping -------------------------------------------------------
function mapStatus(rundownStatus: string | undefined): string {
  if (!rundownStatus) return 'scheduled';
  const s = rundownStatus.toUpperCase();
  if (s.includes('FINAL')) return 'finished';
  if (s.includes('IN_PROGRESS') || s.includes('HALFTIME') || s.includes('LIVE')) return 'live';
  if (s.includes('CANCEL') || s.includes('POSTPONE')) return 'cancelled';
  return 'scheduled';
}

// ---- DB helpers ----------------------------------------------------------
async function getSportId(c: Client, slug: string): Promise<string> {
  const r = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM sports WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`sport slug not found in DB: ${slug}`);
  return row.bbs_id;
}

async function getLeagueId(c: Client, sportId: string, leagueName: string): Promise<string> {
  const r = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM leagues WHERE sport_id = $1 AND name = $2 LIMIT 1`,
    [sportId, leagueName],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`league not found: sport=${sportId} name=${leagueName}`);
  return row.bbs_id;
}

async function upsertTeam(
  c: Client,
  rundownId: number,
  name: string,
  shortName: string | null,
  leagueId: string,
): Promise<string> {
  // Try to find an existing row by external_ids.therundown
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'therundown' = $1 LIMIT 1`,
    [String(rundownId)],
  );
  const row = existing.rows[0];
  if (row) return row.bbs_id;

  const id = randomUUID();
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, short_name, external_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id, leagueId, name, shortName, JSON.stringify({ therundown: String(rundownId) })],
  );
  return id;
}

async function upsertMatch(
  c: Client,
  event: RundownEvent,
  leagueId: string,
  homeTeamId: string,
  awayTeamId: string,
  sportSlug: string,
): Promise<string> {
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM matches WHERE external_ids->>'therundown' = $1 LIMIT 1`,
    [event.event_id],
  );
  const row = existing.rows[0];
  const status = mapStatus(event.score?.event_status);

  if (row) {
    await c.query(
      `UPDATE matches
         SET status = $1,
             kickoff_utc = $2::timestamptz,
             updated_at = NOW()
       WHERE bbs_id = $3`,
      [status, event.event_date, row.bbs_id],
    );
    return row.bbs_id;
  }

  const id = randomUUID();
  await c.query(
    `INSERT INTO matches (bbs_id, league_id, home_id, away_id, kickoff_utc, status, sport_type, external_ids)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb)`,
    [
      id,
      leagueId,
      homeTeamId,
      awayTeamId,
      event.event_date,
      status,
      sportSlug,
      JSON.stringify({ therundown: event.event_id }),
    ],
  );
  return id;
}

async function insertMatchStats(
  c: Client,
  matchId: string,
  event: RundownEvent,
  homeTeamId: string,
  awayTeamId: string,
): Promise<void> {
  const score = event.score;
  if (!score) return;
  const rows: Array<[string, string, string]> = [];
  if (typeof score.score_home === 'number') {
    rows.push([matchId, homeTeamId, JSON.stringify({ score: score.score_home })]);
  }
  if (typeof score.score_away === 'number') {
    rows.push([matchId, awayTeamId, JSON.stringify({ score: score.score_away })]);
  }
  for (const [mId, tId, value] of rows) {
    await c.query(
      `INSERT INTO match_stats (match_id, team_id, field, value, source, confidence, fetched_at)
         VALUES ($1, $2, 'score', $3::jsonb, 'therundown', 0.85, NOW())`,
      [mId, tId, value],
    );
  }
}

async function insertOdds(
  c: Client,
  matchId: string,
  markets: readonly RundownMarket[],
): Promise<number> {
  let count = 0;
  for (const m of markets) {
    const marketName = (m.name ?? `market_${m.market_id}`).toLowerCase();
    for (const p of m.participants ?? []) {
      for (const line of p.lines ?? []) {
        for (const [bookId, price] of Object.entries(line.prices ?? {})) {
          if (!price.is_main_line) continue; // only store main lines (smaller volume)
          await c.query(
            `INSERT INTO odds (match_id, market, sportsbook, line, fetched_at)
               VALUES ($1, $2, $3, $4::jsonb, NOW())`,
            [
              matchId,
              marketName,
              `rundown_book_${bookId}`,
              JSON.stringify({
                participant: p.name,
                value: line.value ?? null,
                price: price.price ?? null,
              }),
            ],
          );
          count += 1;
        }
      }
    }
  }
  return count;
}

// ---- Main ingest loop ----------------------------------------------------
async function ingestSport(
  c: Client,
  apiKey: string,
  mapping: SportMapping,
  date: string,
): Promise<{ events: number; oddsRows: number }> {
  const sportId = await getSportId(c, mapping.sportSlug);
  const leagueId = await getLeagueId(c, sportId, mapping.leagueName);

  const url = `${BASE}/sports/${mapping.rundownSportId}/events/${encodeURIComponent(date)}?include=scores,all_periods&market_ids=1,2,3&main_line=true`;
  const res = await fetch(url, {
    headers: { [AUTH_HEADER]: apiKey, accept: 'application/json' },
  });
  if (!res.ok) {
    if (res.status === 404) {
      console.log(`  · no events for ${mapping.leagueName} on ${date}`);
      return { events: 0, oddsRows: 0 };
    }
    throw new Error(`Rundown HTTP ${res.status} for sport ${mapping.rundownSportId}`);
  }
  const body = (await res.json()) as RundownEventsResponse;
  const events = body.events ?? [];

  let oddsCount = 0;
  for (const ev of events) {
    const teams = ev.teams ?? [];
    const home = teams.find((t) => t.is_home) ?? teams[1];
    const away = teams.find((t) => t.is_away) ?? teams[0];
    if (!home || !away) continue;

    try {
      const homeName = `${home.name} ${home.mascot ?? ''}`.trim();
      const awayName = `${away.name} ${away.mascot ?? ''}`.trim();
      const homeId = await upsertTeam(c, home.team_id, homeName, home.abbreviation ?? null, leagueId);
      const awayId = await upsertTeam(c, away.team_id, awayName, away.abbreviation ?? null, leagueId);
      const matchId = await upsertMatch(c, ev, leagueId, homeId, awayId, mapping.sportSlug);
      await insertMatchStats(c, matchId, ev, homeId, awayId);
      const rows = await insertOdds(c, matchId, ev.markets ?? []);
      oddsCount += rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ event ${ev.event_id}: ${msg}`);
    }
  }
  return { events: events.length, oddsRows: oddsCount };
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['RUNDOWN_API_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('RUNDOWN_API_KEY is required');

  // Parse CLI args (robust — flag must exist, and the value must not start with --)
  const args = process.argv.slice(2);
  function flagValue(name: string): string | undefined {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('--')) return undefined;
    return v;
  }
  const sportArg = flagValue('--sport');
  const dateArg = flagValue('--date');
  const daysArg = process.env['INGEST_DAYS'] ?? '1';
  const days = Math.max(1, Math.min(7, Number.parseInt(daysArg, 10) || 1));

  const targets = sportArg && sportArg !== 'all'
    ? SPORT_MAP.filter((m) => m.leagueName.toLowerCase() === sportArg.toLowerCase())
    : SPORT_MAP;

  if (targets.length === 0) {
    console.error(`No sports matched --sport=${sportArg}`);
    process.exit(1);
  }

  const dates: string[] = [];
  if (dateArg) {
    dates.push(dateArg);
  } else {
    const today = new Date();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  console.log(`→ ingesting ${targets.length} league(s) × ${dates.length} date(s)`);
  const client = new Client({ connectionString: url });
  await client.connect();

  let totalEvents = 0;
  let totalOdds = 0;
  try {
    for (const date of dates) {
      for (const mapping of targets) {
        process.stdout.write(`· ${mapping.leagueName} @ ${date} … `);
        try {
          const { events, oddsRows } = await ingestSport(client, apiKey, mapping, date);
          totalEvents += events;
          totalOdds += oddsRows;
          console.log(`${events} events, ${oddsRows} odds rows`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`✗ ${msg}`);
        }
      }
    }
  } finally {
    await client.end();
  }
  console.log(`\n✓ done. ${totalEvents} events, ${totalOdds} odds rows total.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-rundown] fatal: ${msg}`);
  process.exit(1);
});
