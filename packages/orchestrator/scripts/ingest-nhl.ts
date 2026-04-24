/**
 * NHL official API → Postgres.
 *
 * api-web.nhle.com is free and public. Populates:
 *   - players: full NHL roster per team with headshots, birth info
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-nhl.ts
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api-web.nhle.com/v1';
const DELAY_MS = 400;

// Map TheSportsDB/Rundown NHL team names → NHL official 3-letter code.
const NHL_TEAM_CODES: Record<string, string> = {
  'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI',
  'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK',
  'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI',
  'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA',
  'Utah Mammoth': 'UTA',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

interface NhlPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber?: number;
  positionCode?: string;
  heightInInches?: number;
  weightInPounds?: number;
  birthDate?: string;
  birthCity?: { default?: string };
  birthCountry?: string;
  headshot?: string;
}

interface NhlRoster {
  forwards?: readonly NhlPlayer[];
  defensemen?: readonly NhlPlayer[];
  goalies?: readonly NhlPlayer[];
}

function heightFmt(inches: number | undefined): string | null {
  if (!inches) return null;
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}' ${inch}"`;
}

async function fetchRoster(teamCode: string): Promise<readonly NhlPlayer[]> {
  const res = await fetch(`${BASE}/roster/${teamCode}/current`);
  if (!res.ok) return [];
  const body = (await res.json()) as NhlRoster;
  return [
    ...(body.forwards ?? []),
    ...(body.defensemen ?? []),
    ...(body.goalies ?? []),
  ];
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const nhl = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = 'NHL' LIMIT 1`,
      );
      const nhlLeagueId = nhl.rows[0]?.bbs_id;
      if (!nhlLeagueId) throw new Error('NHL league not found');

      // Find all our NHL teams.
      const teams = await client.query<{ bbs_id: string; name: string }>(
        `SELECT bbs_id, name FROM teams WHERE league_id = $1`,
        [nhlLeagueId],
      );
      console.log(`→ NHL teams in DB: ${teams.rows.length}`);

      let totalCreated = 0;
      let totalUpdated = 0;
      let totalMissing = 0;

      for (const t of teams.rows) {
        const code = NHL_TEAM_CODES[t.name];
        if (!code) {
          console.log(`  ? ${t.name}: no NHL code mapping`);
          totalMissing += 1;
          continue;
        }
        process.stdout.write(`  · ${t.name} (${code}) … `);
        try {
          const roster = await fetchRoster(code);
          let c = 0;
          let u = 0;
          for (const p of roster) {
            const name = `${p.firstName?.default ?? ''} ${p.lastName?.default ?? ''}`.trim();
            if (!name) continue;
            const jersey = p.sweaterNumber ? String(p.sweaterNumber) : null;
            const height = heightFmt(p.heightInInches);
            const weight = p.weightInPounds ? `${p.weightInPounds} lb` : null;
            const dob = p.birthDate ?? null;
            const nationality = p.birthCountry ?? null;

            const existing = await client.query<{ bbs_id: string }>(
              `SELECT bbs_id FROM players WHERE external_ids->>'nhl' = $1 LIMIT 1`,
              [String(p.id)],
            );
            if (existing.rows[0]) {
              await client.query(
                `UPDATE players
                   SET team_id = $1, name = $2, position = $3, jersey_number = $4,
                       height = COALESCE($5, height), weight = COALESCE($6, weight),
                       dob = COALESCE($7::date, dob), nationality = COALESCE($8, nationality),
                       headshot_url = COALESCE($9, headshot_url),
                       external_ids = external_ids || jsonb_build_object('nhl', $10::text)
                 WHERE bbs_id = $11`,
                [
                  t.bbs_id, name, p.positionCode ?? null, jersey,
                  height, weight, dob, nationality, p.headshot ?? null,
                  String(p.id), existing.rows[0].bbs_id,
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
                  id, t.bbs_id, name, p.positionCode ?? null, jersey,
                  height, weight, dob, nationality, p.headshot ?? null,
                  JSON.stringify({ nhl: String(p.id) }),
                ],
              );
              c += 1;
            }
          }
          totalCreated += c;
          totalUpdated += u;
          console.log(`${roster.length} players (${c} new, ${u} updated)`);
        } catch (err) {
          console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      console.log(
        `\n✓ done. ${totalCreated} new, ${totalUpdated} updated, ${totalMissing} teams unmapped.`,
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-nhl] fatal: ${msg}`);
  process.exit(1);
});
