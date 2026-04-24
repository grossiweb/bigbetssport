/**
 * MLB StatsAPI → Postgres. Official MLB feed (statsapi.mlb.com).
 *
 * Free, no key. Populates:
 *   - MLB rosters (40-man) per team with headshot URLs
 *
 * (A follow-up pass can pull per-game boxscores via /game/{gamePk}/boxscore
 *  but MLB games are already covered by our ESPN stats ingest.)
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-mlb.ts
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://statsapi.mlb.com/api/v1';
const DELAY_MS = 250;

interface MlbTeam {
  id: number;
  name: string;
  abbreviation?: string;
  teamName?: string;
  locationName?: string;
}

interface MlbPlayerRef {
  id: number;
  fullName: string;
  link?: string;
}

interface MlbRosterEntry {
  person: MlbPlayerRef;
  jerseyNumber?: string;
  position?: { abbreviation?: string };
  status?: { description?: string };
}

interface MlbPersonDetail {
  id: number;
  fullName: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  birthCity?: string;
  birthCountry?: string;
  height?: string;
  weight?: number;
  currentAge?: number;
  primaryPosition?: { abbreviation?: string };
  batSide?: { description?: string };
  pitchHand?: { description?: string };
}

function mlbHeadshotUrl(personId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/${personId}/headshot/silo/current.png`;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const mlb = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = 'MLB' LIMIT 1`,
      );
      const mlbLeagueId = mlb.rows[0]?.bbs_id;
      if (!mlbLeagueId) throw new Error('MLB league not found');

      console.log('→ fetching MLB teams…');
      const teamsRes = await fetch(`${BASE}/teams?sportId=1&activeStatus=ACTIVE`);
      if (!teamsRes.ok) throw new Error(`teams HTTP ${teamsRes.status}`);
      const teams = ((await teamsRes.json()) as { teams: readonly MlbTeam[] }).teams;
      console.log(`  ${teams.length} active teams`);

      // Map MLB team id → our team bbs_id.
      const teamLookup = new Map<number, string>();
      for (const t of teams) {
        const candidates = [t.name, `${t.locationName ?? ''} ${t.teamName ?? ''}`.trim()];
        for (const candidate of candidates) {
          if (!candidate) continue;
          const r = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM teams
               WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
            [mlbLeagueId, candidate],
          );
          if (r.rows[0]) {
            teamLookup.set(t.id, r.rows[0].bbs_id);
            await client.query(
              `UPDATE teams
                 SET external_ids = external_ids || jsonb_build_object('mlb', $1::text)
               WHERE bbs_id = $2`,
              [String(t.id), r.rows[0].bbs_id],
            );
            break;
          }
        }
      }
      console.log(`  matched ${teamLookup.size}/${teams.length} MLB teams`);

      let totalCreated = 0;
      let totalUpdated = 0;

      for (const t of teams) {
        const ourTeamId = teamLookup.get(t.id);
        if (!ourTeamId) continue;

        process.stdout.write(`  · ${t.name} … `);
        try {
          // 40-man roster.
          const rosterRes = await fetch(`${BASE}/teams/${t.id}/roster?rosterType=40Man`);
          if (!rosterRes.ok) throw new Error(`roster HTTP ${rosterRes.status}`);
          const roster = ((await rosterRes.json()) as {
            roster: readonly MlbRosterEntry[];
          }).roster;

          let c = 0;
          let u = 0;
          for (const entry of roster) {
            const person = entry.person;
            // Fetch person details in a second call for height/weight/dob/etc.
            const detailRes = await fetch(`${BASE}/people/${person.id}`);
            const detail = detailRes.ok
              ? (((await detailRes.json()) as { people?: readonly MlbPersonDetail[] }).people?.[0] ?? null)
              : null;

            const existing = await client.query<{ bbs_id: string }>(
              `SELECT bbs_id FROM players WHERE external_ids->>'mlb' = $1 LIMIT 1`,
              [String(person.id)],
            );

            const position = entry.position?.abbreviation ?? detail?.primaryPosition?.abbreviation ?? null;
            const height = detail?.height ?? null;
            const weight = detail?.weight ? `${detail.weight} lb` : null;
            const dob = detail?.birthDate ?? null;
            const nat = detail?.birthCountry ?? null;

            if (existing.rows[0]) {
              await client.query(
                `UPDATE players
                   SET team_id = $1, name = $2, position = $3, jersey_number = $4,
                       height = COALESCE($5, height), weight = COALESCE($6, weight),
                       dob = COALESCE($7::date, dob), nationality = COALESCE($8, nationality),
                       headshot_url = COALESCE($9, headshot_url),
                       external_ids = external_ids || jsonb_build_object('mlb', $10::text)
                 WHERE bbs_id = $11`,
                [
                  ourTeamId, person.fullName, position, entry.jerseyNumber ?? null,
                  height, weight, dob, nat, mlbHeadshotUrl(person.id),
                  String(person.id), existing.rows[0].bbs_id,
                ],
              );
              u += 1;
            } else {
              const id = randomUUID();
              await client.query(
                `INSERT INTO players
                   (bbs_id, team_id, name, position, jersey_number, height,
                    weight, dob, nationality, headshot_url, external_ids)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
                [
                  id, ourTeamId, person.fullName, position, entry.jerseyNumber ?? null,
                  height, weight, dob, nat, mlbHeadshotUrl(person.id),
                  JSON.stringify({ mlb: String(person.id) }),
                ],
              );
              c += 1;
            }
            await new Promise((r) => setTimeout(r, DELAY_MS));
          }
          totalCreated += c;
          totalUpdated += u;
          console.log(`${roster.length} players (${c} new, ${u} updated)`);
        } catch (err) {
          console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(`\n✓ done. ${totalCreated} new, ${totalUpdated} updated.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-mlb] fatal: ${msg}`);
  process.exit(1);
});
