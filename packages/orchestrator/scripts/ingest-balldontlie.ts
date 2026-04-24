/**
 * BallDontLie → Postgres. Deep NBA roster + season averages.
 *
 * api.balldontlie.io v1 now requires a free key. We already have NBA
 * players via TheSportsDB; BallDontLie adds college, country, draft
 * round/number/year, and reliable jersey_number / position fields.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-balldontlie.ts
 *
 * Env:
 *   DATABASE_URL          (required)
 *   BALLDONTLIE_API_KEY   (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.balldontlie.io/v1';
const DELAY_MS = 250;

interface BdlTeam {
  id: number;
  full_name: string;
  abbreviation: string;
  city: string;
  name: string;
}

interface BdlPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position?: string;
  height?: string;
  weight?: string;
  jersey_number?: string | null;
  college?: string | null;
  country?: string | null;
  draft_year?: number | null;
  draft_round?: number | null;
  draft_number?: number | null;
  team: BdlTeam;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['BALLDONTLIE_API_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('BALLDONTLIE_API_KEY is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const nba = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = 'NBA' LIMIT 1`,
      );
      const nbaLeagueId = nba.rows[0]?.bbs_id;
      if (!nbaLeagueId) throw new Error('NBA league not found');

      // Paginate through active players.
      let cursor: number | null = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      const teamLookup = new Map<number, string>();

      while (cursor !== null) {
        const cursorParam = cursor > 0 ? `&cursor=${cursor}` : '';
        // `/players/active` requires a higher tier; `/players` is free.
        const res = await fetch(`${BASE}/players?per_page=100${cursorParam}`, {
          headers: { Authorization: apiKey },
        });
        if (!res.ok) {
          console.error(`  ✗ HTTP ${res.status}`);
          break;
        }
        const body = (await res.json()) as {
          data: readonly BdlPlayer[];
          meta?: { next_cursor?: number | null };
        };
        for (const p of body.data) {
          // Resolve team.
          let teamId = teamLookup.get(p.team.id);
          if (!teamId) {
            const r = await client.query<{ bbs_id: string }>(
              `SELECT bbs_id FROM teams
                 WHERE league_id = $1 AND (LOWER(name) = LOWER($2) OR LOWER(name) = LOWER($3))
                 LIMIT 1`,
              [nbaLeagueId, p.team.full_name, `${p.team.city} ${p.team.name}`],
            );
            teamId = r.rows[0]?.bbs_id;
            if (teamId) {
              teamLookup.set(p.team.id, teamId);
              await client.query(
                `UPDATE teams
                   SET external_ids = external_ids || jsonb_build_object('balldontlie', $1::text)
                 WHERE bbs_id = $2`,
                [String(p.team.id), teamId],
              );
            }
          }

          const displayName = `${p.first_name} ${p.last_name}`.trim();
          const existing = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM players WHERE external_ids->>'balldontlie' = $1 LIMIT 1`,
            [String(p.id)],
          );

          const bdlExtras = {
            college: p.college ?? null,
            draft_year: p.draft_year ?? null,
            draft_round: p.draft_round ?? null,
            draft_number: p.draft_number ?? null,
          };

          if (existing.rows[0]) {
            await client.query(
              `UPDATE players
                 SET team_id = COALESCE($1, team_id), name = $2,
                     position = COALESCE($3, position),
                     jersey_number = COALESCE($4, jersey_number),
                     height = COALESCE($5, height), weight = COALESCE($6, weight),
                     nationality = COALESCE($7, nationality),
                     external_ids = external_ids
                       || jsonb_build_object('balldontlie', $8::text)
                       || jsonb_build_object('balldontlie_meta', $9::jsonb)
               WHERE bbs_id = $10`,
              [
                teamId ?? null, displayName, p.position ?? null, p.jersey_number ?? null,
                p.height ?? null, p.weight ?? null, p.country ?? null,
                String(p.id), JSON.stringify(bdlExtras), existing.rows[0].bbs_id,
              ],
            );
            totalUpdated += 1;
          } else {
            const id = randomUUID();
            await client.query(
              `INSERT INTO players
                 (bbs_id, team_id, name, position, jersey_number, height,
                  weight, nationality, external_ids)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
              [
                id, teamId ?? null, displayName, p.position ?? null, p.jersey_number ?? null,
                p.height ?? null, p.weight ?? null, p.country ?? null,
                JSON.stringify({ balldontlie: String(p.id), balldontlie_meta: bdlExtras }),
              ],
            );
            totalCreated += 1;
          }
        }
        console.log(`  processed ${body.data.length} players (cursor ${cursor})`);
        cursor = body.meta?.next_cursor ?? null;
        await new Promise((r) => setTimeout(r, DELAY_MS));
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
  console.error(`[ingest-balldontlie] fatal: ${msg}`);
  process.exit(1);
});
