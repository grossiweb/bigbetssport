/**
 * TheSportsDB → Postgres player ingest.
 *
 * For every team in our DB with a `external_ids.thesportsdb` id, fetches
 * the roster via `lookup_all_players.php?id={teamId}` and upserts into
 * the `players` table (auto-creates on first run, updates on subsequent).
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-players-thesportsdb.ts [--limit N]
 *
 * Env:
 *   DATABASE_URL         (required)
 *   THESPORTSDB_API_KEY  (optional, defaults to "3")
 *
 * Rate: 1s delay between teams. For ~183 teams expect ~3 minutes.
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const API_KEY = process.env['THESPORTSDB_API_KEY'] ?? '3';
const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const DELAY_MS = 1000;

interface TsdbPlayer {
  idPlayer: string;
  strPlayer: string;
  strTeam?: string | null;
  strPosition?: string | null;
  strNationality?: string | null;
  dateBorn?: string | null;     // YYYY-MM-DD or empty
  strNumber?: string | null;
  strHeight?: string | null;
  strWeight?: string | null;
  strCutout?: string | null;    // headshot
  strThumb?: string | null;     // fallback image
  strDescriptionEN?: string | null;
}

interface TeamWithTsdb {
  bbs_id: string;
  tsdb_id: string;
  name: string;
}

async function fetchRoster(teamTsdbId: string): Promise<readonly TsdbPlayer[]> {
  const url = `${BASE}/lookup_all_players.php?id=${encodeURIComponent(teamTsdbId)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { player?: readonly TsdbPlayer[] | null };
  return body.player ?? [];
}

function safeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // TheSportsDB returns 'YYYY-MM-DD' or '0000-00-00'; reject obviously bad.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (raw.startsWith('0000')) return null;
  return raw;
}

async function upsertPlayer(
  c: Client,
  teamId: string,
  p: TsdbPlayer,
): Promise<'inserted' | 'updated'> {
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM players WHERE external_ids->>'thesportsdb' = $1 LIMIT 1`,
    [p.idPlayer],
  );
  const headshot = p.strCutout ?? p.strThumb ?? null;
  const fields = {
    name: p.strPlayer,
    position: p.strPosition ?? null,
    nationality: p.strNationality ?? null,
    dob: safeDate(p.dateBorn),
    jersey: p.strNumber ?? null,
    height: p.strHeight ?? null,
    weight: p.strWeight ?? null,
    headshot,
    description: p.strDescriptionEN ?? null,
  };

  if (existing.rows[0]) {
    await c.query(
      `UPDATE players
         SET team_id = $1,
             name = $2,
             position = $3,
             nationality = $4,
             dob = $5,
             jersey_number = $6,
             height = $7,
             weight = $8,
             headshot_url = $9,
             description = $10
       WHERE bbs_id = $11`,
      [
        teamId,
        fields.name,
        fields.position,
        fields.nationality,
        fields.dob,
        fields.jersey,
        fields.height,
        fields.weight,
        fields.headshot,
        fields.description,
        existing.rows[0].bbs_id,
      ],
    );
    return 'updated';
  }

  const id = randomUUID();
  await c.query(
    `INSERT INTO players
       (bbs_id, team_id, name, position, nationality, dob, jersey_number,
        height, weight, headshot_url, description, external_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
    [
      id,
      teamId,
      fields.name,
      fields.position,
      fields.nationality,
      fields.dob,
      fields.jersey,
      fields.height,
      fields.weight,
      fields.headshot,
      fields.description,
      JSON.stringify({ thesportsdb: p.idPlayer }),
    ],
  );
  return 'inserted';
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const args = process.argv.slice(2);
  const limitArg = args[args.indexOf('--limit') + 1];
  const limit = args.includes('--limit') && limitArg ? Number.parseInt(limitArg, 10) : 0;

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const teams = await client.query<TeamWithTsdb>(
      `SELECT bbs_id, external_ids->>'thesportsdb' AS tsdb_id, name
         FROM teams
        WHERE external_ids ? 'thesportsdb'
        ORDER BY name
        ${limit > 0 ? `LIMIT ${limit}` : ''}`,
    );

    console.log(`→ ingesting players for ${teams.rows.length} team(s)`);
    let totalInserted = 0;
    let totalUpdated = 0;
    let teamsWithPlayers = 0;

    for (const team of teams.rows) {
      process.stdout.write(`  · ${team.name} … `);
      try {
        const roster = await fetchRoster(team.tsdb_id);
        let inserted = 0;
        let updated = 0;
        for (const p of roster) {
          try {
            const outcome = await upsertPlayer(client, team.bbs_id, p);
            if (outcome === 'inserted') inserted += 1;
            else updated += 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`\n    ✗ ${p.strPlayer}: ${msg}`);
          }
        }
        totalInserted += inserted;
        totalUpdated += updated;
        if (roster.length > 0) teamsWithPlayers += 1;
        console.log(`${roster.length} players (${inserted} new, ${updated} updated)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${msg}`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    console.log(
      `\n✓ done. ${totalInserted} new players, ${totalUpdated} updated, ${teamsWithPlayers}/${teams.rows.length} teams with roster.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-players] fatal: ${msg}`);
  process.exit(1);
});
