/**
 * API-Sports (basketball.api-sports.io) → Postgres.
 *
 * User-provided key is scoped to /basketball/. We use it to pull
 * international basketball leagues (EuroLeague, ACB, etc.) that we
 * don't get from ESPN/Rundown.
 *
 * Writes: leagues, teams, and scheduled games for the current season.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-api-sports.ts
 *
 * Env:
 *   DATABASE_URL    (required)
 *   API_SPORTS_KEY  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://v1.basketball.api-sports.io';

interface ApiSportsLeague {
  id: number;
  name: string;
  type: string;
  logo?: string;
  country?: { name?: string };
  seasons?: ReadonlyArray<{ season: number; start: string; end: string }>;
}

interface ApiSportsTeam {
  id: number;
  name: string;
  logo?: string;
}

interface ApiSportsGame {
  id: number;
  date: string;
  status?: { short?: string; long?: string };
  league: { id: number; name: string; logo?: string };
  country?: { name?: string };
  teams: { home: ApiSportsTeam; away: ApiSportsTeam };
  scores: {
    home?: { total?: number | null; quarter_1?: number | null; quarter_2?: number | null; quarter_3?: number | null; quarter_4?: number | null };
    away?: { total?: number | null; quarter_1?: number | null; quarter_2?: number | null; quarter_3?: number | null; quarter_4?: number | null };
  };
  season?: number;
}

const LEAGUES_OF_INTEREST = [
  // These are common league IDs; we filter by name rather than hard-code.
];
void LEAGUES_OF_INTEREST;

function statusMap(s?: string): string {
  if (!s) return 'scheduled';
  if (s === 'FT' || s === 'AOT') return 'finished';
  if (s === 'Q1' || s === 'Q2' || s === 'Q3' || s === 'Q4' || s === 'HT' || s === 'BT' || s === 'OT') return 'live';
  return 'scheduled';
}

async function ensureLeague(
  c: import('pg').PoolClient,
  name: string,
  country: string | null,
  season: string,
): Promise<string> {
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM leagues WHERE name = $1 AND season = $2 LIMIT 1`,
    [name, season],
  );
  if (existing.rows[0]) return existing.rows[0].bbs_id;
  const sp = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM sports WHERE slug = 'basketball' LIMIT 1`,
  );
  const sportId = sp.rows[0]?.bbs_id;
  if (!sportId) throw new Error('basketball sport not seeded');
  const id = randomUUID();
  await c.query(
    `INSERT INTO leagues (bbs_id, sport_id, name, country, season, external_ids)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
    [id, sportId, name, country ?? 'International', season],
  );
  return id;
}

async function upsertTeam(
  c: import('pg').PoolClient,
  leagueId: string,
  team: ApiSportsTeam,
): Promise<string> {
  const byExt = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'api-sports' = $1 LIMIT 1`,
    [String(team.id)],
  );
  if (byExt.rows[0]) return byExt.rows[0].bbs_id;
  const byName = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [leagueId, team.name],
  );
  if (byName.rows[0]) {
    await c.query(
      `UPDATE teams
         SET external_ids = external_ids || jsonb_build_object('api-sports', $1::text),
             logo_url = COALESCE(logo_url, $2)
       WHERE bbs_id = $3`,
      [String(team.id), team.logo ?? null, byName.rows[0].bbs_id],
    );
    return byName.rows[0].bbs_id;
  }
  const id = randomUUID();
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, logo_url, external_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id, leagueId, team.name, team.logo ?? null, JSON.stringify({ 'api-sports': String(team.id) })],
  );
  return id;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['API_SPORTS_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('API_SPORTS_KEY is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });
  try {
    const client = await pool.connect();
    try {
      // Fetch games for current season — the endpoint returns games with
      // league + team metadata, we can derive the leagues from there.
      const today = new Date();
      const to = new Date(today); to.setUTCDate(to.getUTCDate() + 14);
      const from = new Date(today); from.setUTCDate(from.getUTCDate() - 14);

      console.log(`→ fetching basketball games ${from.toISOString().slice(0,10)} → ${to.toISOString().slice(0,10)}`);
      let allGames: ApiSportsGame[] = [];
      // The API returns a season as an int; we try current year.
      const season = today.getUTCFullYear();
      const res = await fetch(
        `${BASE}/games?season=${season}&date=${today.toISOString().slice(0, 10)}`,
        { headers: { 'x-apisports-key': apiKey } },
      );
      if (!res.ok) throw new Error(`games HTTP ${res.status}`);
      const body = (await res.json()) as { response?: readonly ApiSportsGame[]; errors?: unknown };
      allGames = [...(body.response ?? [])];
      console.log(`  ${allGames.length} games today`);

      let upserted = 0;
      for (const g of allGames) {
        try {
          const leagueId = await ensureLeague(
            client, g.league.name,
            g.country?.name ?? null,
            String(g.season ?? season),
          );
          const home = await upsertTeam(client, leagueId, g.teams.home);
          const away = await upsertTeam(client, leagueId, g.teams.away);
          const hQ = [g.scores.home?.quarter_1, g.scores.home?.quarter_2, g.scores.home?.quarter_3, g.scores.home?.quarter_4]
            .filter((n): n is number => typeof n === 'number');
          const aQ = [g.scores.away?.quarter_1, g.scores.away?.quarter_2, g.scores.away?.quarter_3, g.scores.away?.quarter_4]
            .filter((n): n is number => typeof n === 'number');
          const linescore = hQ.length > 0 && aQ.length > 0
            ? JSON.stringify({ home: hQ, away: aQ })
            : null;

          const existing = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM matches WHERE external_ids->>'api-sports' = $1 LIMIT 1`,
            [String(g.id)],
          );
          if (existing.rows[0]) {
            await client.query(
              `UPDATE matches
                 SET status = $1, kickoff_utc = $2::timestamptz,
                     home_id = $3, away_id = $4,
                     linescore = COALESCE($5::jsonb, linescore),
                     updated_at = NOW()
               WHERE bbs_id = $6`,
              [statusMap(g.status?.short), g.date, home, away, linescore, existing.rows[0].bbs_id],
            );
          } else {
            const id = randomUUID();
            await client.query(
              `INSERT INTO matches
                 (bbs_id, league_id, home_id, away_id, kickoff_utc, status,
                  sport_type, linescore, external_ids)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'basketball', $7::jsonb, $8::jsonb)`,
              [
                id, leagueId, home, away, g.date, statusMap(g.status?.short),
                linescore, JSON.stringify({ 'api-sports': String(g.id) }),
              ],
            );
          }
          upserted += 1;
        } catch (err) {
          console.error(`  ✗ game ${g.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
      console.log(`\n✓ done. ${upserted} basketball games upserted.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-api-sports] fatal: ${msg}`);
  process.exit(1);
});
