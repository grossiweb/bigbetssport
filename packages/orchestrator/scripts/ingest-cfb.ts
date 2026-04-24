/**
 * CollegeFootballData → Postgres. Adds NCAAF depth beyond ESPN:
 *   - FBS school metadata with official team logos + stadium
 *   - Per-team season records (wins/losses)
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-cfb.ts [--year 2025]
 *
 * Env:
 *   DATABASE_URL  (required)
 *   CFB_API_KEY   (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.collegefootballdata.com';

interface CfbTeam {
  id: number;
  school: string;
  mascot?: string;
  abbreviation?: string;
  conference?: string;
  logos?: readonly string[];
  location?: {
    name?: string;
    city?: string;
    state?: string;
    capacity?: number;
  };
}

interface CfbRecord {
  team: string;
  conference?: string;
  total?: { wins?: number; losses?: number; ties?: number };
  conferenceGames?: { wins?: number; losses?: number; ties?: number };
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['CFB_API_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('CFB_API_KEY is required');

  const args = process.argv.slice(2);
  const yearArg = args[args.indexOf('--year') + 1];
  const year = args.includes('--year') && yearArg && !yearArg.startsWith('--')
    ? Number.parseInt(yearArg, 10)
    : new Date().getUTCFullYear();
  const season = String(year);

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const lg = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = 'NCAAF' LIMIT 1`,
      );
      const leagueId = lg.rows[0]?.bbs_id;
      if (!leagueId) throw new Error('NCAAF league not found');

      // 1) Teams with full metadata.
      console.log(`→ fetching FBS teams for ${year}…`);
      const teamsRes = await fetch(`${BASE}/teams/fbs?year=${year}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!teamsRes.ok) throw new Error(`teams HTTP ${teamsRes.status}`);
      const teams = (await teamsRes.json()) as readonly CfbTeam[];
      console.log(`  ${teams.length} FBS teams`);

      const teamLookup = new Map<string, string>();
      for (const t of teams) {
        const displayName = t.mascot ? `${t.school} ${t.mascot}` : t.school;
        const existingByExt = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM teams WHERE external_ids->>'cfbd' = $1 LIMIT 1`,
          [String(t.id)],
        );
        if (existingByExt.rows[0]) {
          teamLookup.set(t.school, existingByExt.rows[0].bbs_id);
          continue;
        }
        const byName = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM teams
             WHERE league_id = $1 AND (LOWER(name) = LOWER($2) OR LOWER(name) = LOWER($3))
             LIMIT 1`,
          [leagueId, displayName, t.school],
        );
        if (byName.rows[0]) {
          await client.query(
            `UPDATE teams
               SET external_ids = external_ids || jsonb_build_object('cfbd', $1::text),
                   logo_url = COALESCE(logo_url, $2),
                   short_name = COALESCE(short_name, $3)
             WHERE bbs_id = $4`,
            [String(t.id), t.logos?.[0] ?? null, t.abbreviation ?? null, byName.rows[0].bbs_id],
          );
          teamLookup.set(t.school, byName.rows[0].bbs_id);
        } else {
          const id = randomUUID();
          await client.query(
            `INSERT INTO teams (bbs_id, league_id, name, short_name, logo_url, external_ids)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [id, leagueId, displayName, t.abbreviation ?? null, t.logos?.[0] ?? null, JSON.stringify({ cfbd: String(t.id) })],
          );
          teamLookup.set(t.school, id);
        }

        // Upsert venue too.
        if (t.location?.name) {
          const v = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM venues WHERE name = $1 LIMIT 1`,
            [t.location.name],
          );
          if (!v.rows[0]) {
            await client.query(
              `INSERT INTO venues (name, city, country) VALUES ($1, $2, $3)`,
              [t.location.name, t.location.city ?? null, t.location.state ?? null],
            );
          }
        }
      }
      console.log(`  matched/created ${teamLookup.size} teams`);

      // 2) Season records → standings.
      console.log(`→ fetching season records for ${year}…`);
      const recRes = await fetch(`${BASE}/records?year=${year}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!recRes.ok) throw new Error(`records HTTP ${recRes.status}`);
      const records = (await recRes.json()) as readonly CfbRecord[];
      let standings = 0;
      for (const r of records) {
        const teamId = teamLookup.get(r.team);
        if (!teamId) continue;
        const wins = r.total?.wins ?? 0;
        const losses = r.total?.losses ?? 0;
        const ties = r.total?.ties ?? 0;
        const gp = wins + losses + ties;
        const winPct = gp > 0 ? wins / gp : null;
        await client.query(
          `INSERT INTO standings
             (league_id, team_id, season, rank, games_played, wins, losses, ties,
              win_pct, source, updated_at)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, 'cfbd', NOW())
           ON CONFLICT (league_id, team_id, season, source) DO UPDATE
             SET games_played = EXCLUDED.games_played,
                 wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties,
                 win_pct = EXCLUDED.win_pct, updated_at = NOW()`,
          [leagueId, teamId, season, gp, wins, losses, ties, winPct],
        );
        standings += 1;
      }
      console.log(`  ${standings} season records upserted`);

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
  console.error(`[ingest-cfb] fatal: ${msg}`);
  process.exit(1);
});
