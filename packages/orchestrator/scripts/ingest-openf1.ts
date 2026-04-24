/**
 * OpenF1 → Postgres. Formula 1 drivers + recent sessions.
 *
 * api.openf1.org is free and unkeyed. Populates:
 *   - formula1 sport row (already seeded)
 *   - Formula 1 teams (10 constructors — created as our `teams`)
 *   - 20 drivers as `players` linked to their constructor team
 *   - Recent F1 sessions as `matches` (one match per session: Practice,
 *     Qualifying, Sprint, Race).
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-openf1.ts [--year 2025]
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.openf1.org/v1';

interface OpenF1Session {
  session_key: number;
  session_name: string;
  session_type?: string;
  meeting_key: number;
  location: string;
  country_name?: string;
  year: number;
  date_start: string;
  date_end?: string;
  circuit_short_name?: string;
}

interface OpenF1Driver {
  driver_number: number;
  full_name: string;
  first_name?: string;
  last_name?: string;
  name_acronym?: string;
  country_code?: string | null;
  team_name: string;
  team_colour?: string;
  headshot_url?: string;
  session_key: number;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const args = process.argv.slice(2);
  const yearArg = args[args.indexOf('--year') + 1];
  const year =
    args.includes('--year') && yearArg && !yearArg.startsWith('--')
      ? Number.parseInt(yearArg, 10)
      : new Date().getUTCFullYear();

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      // 1) Ensure F1 sport + league exist.
      const sport = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM sports WHERE slug = 'formula1' LIMIT 1`,
      );
      const sportId = sport.rows[0]?.bbs_id;
      if (!sportId) throw new Error('formula1 sport not seeded');

      let leagueIdRes = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE sport_id = $1 AND name = 'F1 World Championship' LIMIT 1`,
        [sportId],
      );
      let leagueId = leagueIdRes.rows[0]?.bbs_id;
      if (!leagueId) {
        leagueId = randomUUID();
        await client.query(
          `INSERT INTO leagues (bbs_id, sport_id, name, country, season, external_ids)
             VALUES ($1, $2, 'F1 World Championship', 'International', $3, '{}'::jsonb)`,
          [leagueId, sportId, String(year)],
        );
        console.log(`  created league 'F1 World Championship' (${year})`);
      }

      // 2) Fetch sessions + drivers.
      console.log(`→ fetching OpenF1 sessions for ${year}…`);
      const sessionsRes = await fetch(`${BASE}/sessions?year=${year}`);
      if (!sessionsRes.ok) throw new Error(`sessions HTTP ${sessionsRes.status}`);
      const sessions = (await sessionsRes.json()) as readonly OpenF1Session[];
      console.log(`  ${sessions.length} sessions`);

      // Grab latest session for driver roster (per-session, but roster
      // is basically stable across a GP weekend).
      const latestKey = sessions[sessions.length - 1]?.session_key;
      if (!latestKey) throw new Error('no sessions found');
      console.log(`→ fetching drivers from session ${latestKey}…`);
      const driversRes = await fetch(`${BASE}/drivers?session_key=${latestKey}`);
      if (!driversRes.ok) throw new Error(`drivers HTTP ${driversRes.status}`);
      const drivers = (await driversRes.json()) as readonly OpenF1Driver[];
      console.log(`  ${drivers.length} drivers`);

      // 3) Upsert constructors as teams (by name).
      const constructorIds = new Map<string, string>();
      for (const d of drivers) {
        if (!d.team_name) continue;
        if (constructorIds.has(d.team_name)) continue;
        const existing = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM teams WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [leagueId, d.team_name],
        );
        if (existing.rows[0]) {
          constructorIds.set(d.team_name, existing.rows[0].bbs_id);
        } else {
          const id = randomUUID();
          await client.query(
            `INSERT INTO teams (bbs_id, league_id, name, external_ids)
               VALUES ($1, $2, $3, '{}'::jsonb)`,
            [id, leagueId, d.team_name],
          );
          constructorIds.set(d.team_name, id);
        }
      }
      console.log(`  ${constructorIds.size} constructors`);

      // 4) Upsert drivers as players.
      let driversCreated = 0;
      let driversUpdated = 0;
      for (const d of drivers) {
        const teamId = constructorIds.get(d.team_name) ?? null;
        const existing = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM players WHERE external_ids->>'openf1' = $1 LIMIT 1`,
          [String(d.driver_number)],
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE players
               SET team_id = $1, name = $2, jersey_number = $3,
                   nationality = COALESCE($4, nationality),
                   headshot_url = COALESCE($5, headshot_url),
                   external_ids = external_ids || jsonb_build_object('openf1', $6::text)
             WHERE bbs_id = $7`,
            [
              teamId, d.full_name, String(d.driver_number),
              d.country_code ?? null, d.headshot_url ?? null,
              String(d.driver_number), existing.rows[0].bbs_id,
            ],
          );
          driversUpdated += 1;
        } else {
          const id = randomUUID();
          await client.query(
            `INSERT INTO players
               (bbs_id, team_id, name, jersey_number, nationality, headshot_url, external_ids)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
              id, teamId, d.full_name, String(d.driver_number),
              d.country_code ?? null, d.headshot_url ?? null,
              JSON.stringify({ openf1: String(d.driver_number) }),
            ],
          );
          driversCreated += 1;
        }
      }
      console.log(`  drivers: ${driversCreated} new, ${driversUpdated} updated`);

      // 5) Upsert recent sessions as matches. Each F1 session becomes a
      //    match with sport_type='formula1', home_id=constructor of
      //    winner (unfilled for now), away_id=null.
      // We filter to Race + Qualifying sessions to reduce noise.
      const raceSessions = sessions.filter((s) =>
        ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying', 'Sprint Shootout'].includes(
          s.session_name,
        ),
      );

      let matchesCreated = 0;
      let matchesUpdated = 0;
      for (const s of raceSessions) {
        const existing = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM matches WHERE external_ids->>'openf1_session' = $1 LIMIT 1`,
          [String(s.session_key)],
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE matches
               SET kickoff_utc = $1::timestamptz,
                   updated_at = NOW()
             WHERE bbs_id = $2`,
            [s.date_start, existing.rows[0].bbs_id],
          );
          matchesUpdated += 1;
        } else {
          const id = randomUUID();
          await client.query(
            `INSERT INTO matches
               (bbs_id, league_id, home_id, away_id, kickoff_utc,
                status, sport_type, external_ids)
             VALUES ($1, $2, NULL, NULL, $3::timestamptz, 'scheduled', 'formula1', $4::jsonb)`,
            [
              id,
              leagueId,
              s.date_start,
              JSON.stringify({
                openf1_session: String(s.session_key),
                openf1_meeting: String(s.meeting_key),
                session_name: s.session_name,
                location: s.location,
              }),
            ],
          );
          matchesCreated += 1;
        }
      }
      console.log(`  sessions as matches: ${matchesCreated} new, ${matchesUpdated} updated`);

      console.log('\n✓ done.');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-openf1] fatal: ${msg}`);
  process.exit(1);
});
