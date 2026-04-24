/**
 * Fantasy Premier League → Postgres ingest.
 *
 * FPL's bootstrap-static endpoint exposes every EPL player with rich
 * per-season stats including xG, xA, ict_index, form, and selected_by.
 * No API key required.
 *
 * Writes:
 *   - players: new EPL players (team_id = our EPL team via FPL team index)
 *   - player_stats: per-player season aggregate under source='fpl',
 *     keyed as match_id=NULL isn't allowed, so we use a synthetic
 *     season-match via matches table? Simpler: upsert into a new
 *     player_season_stats pattern via player_stats with match_id set
 *     to a sentinel row per season.
 *
 * To avoid schema drift we store season aggregates as `season_stats`
 * JSONB on the player row via external_ids['fpl_stats'] (simple, atomic).
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-fpl.ts
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

interface FplTeam {
  id: number;
  name: string;
  short_name: string;
}

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  now_cost: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  form: string;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  photo: string;       // e.g. "223094.jpg" → https://resources.premierleague.com/premierleague/photos/players/110x140/p{photo.stem}.png
  selected_by_percent: string;
}

interface FplBootstrap {
  teams: readonly FplTeam[];
  elements: readonly FplElement[];
}

const POSITION: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

function headshotUrl(photoFilename: string): string | null {
  if (!photoFilename) return null;
  const stem = photoFilename.replace(/\.[a-z]+$/i, '');
  return `https://resources.premierleague.com/premierleague/photos/players/250x250/p${stem}.png`;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    console.log('→ fetching FPL bootstrap-static…');
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
    if (!res.ok) throw new Error(`FPL HTTP ${res.status}`);
    const body = (await res.json()) as FplBootstrap;
    console.log(`  found ${body.teams.length} teams, ${body.elements.length} players`);

    const client = await pool.connect();
    try {
      // Map FPL team id → our EPL team bbs_id
      const epl = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = 'EPL' LIMIT 1`,
      );
      const eplLeagueId = epl.rows[0]?.bbs_id;
      if (!eplLeagueId) throw new Error('EPL league not found');

      const teamLookup = new Map<number, string>();
      for (const t of body.teams) {
        // Try match by name case-insensitive against our teams in EPL.
        const r = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM teams
             WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [eplLeagueId, t.name],
        );
        if (r.rows[0]) {
          teamLookup.set(t.id, r.rows[0].bbs_id);
          // Also stash fpl id on the team
          await client.query(
            `UPDATE teams
               SET external_ids = external_ids || jsonb_build_object('fpl', $1::text)
             WHERE bbs_id = $2`,
            [String(t.id), r.rows[0].bbs_id],
          );
        }
      }
      console.log(`  matched ${teamLookup.size}/${body.teams.length} FPL teams`);

      let upserts = 0;
      let created = 0;
      for (const p of body.elements) {
        const teamId = teamLookup.get(p.team) ?? null;
        const displayName = `${p.first_name} ${p.second_name}`.trim();
        const position = POSITION[p.element_type] ?? null;
        const headshot = headshotUrl(p.photo);

        const seasonStats = {
          minutes: p.minutes,
          goals: p.goals_scored,
          assists: p.assists,
          clean_sheets: p.clean_sheets,
          goals_conceded: p.goals_conceded,
          yellow_cards: p.yellow_cards,
          red_cards: p.red_cards,
          saves: p.saves,
          bonus: p.bonus,
          form: Number(p.form),
          influence: Number(p.influence),
          creativity: Number(p.creativity),
          threat: Number(p.threat),
          ict_index: Number(p.ict_index),
          expected_goals: Number(p.expected_goals),
          expected_assists: Number(p.expected_assists),
          expected_goal_involvements: Number(p.expected_goal_involvements),
          expected_goals_conceded: Number(p.expected_goals_conceded),
          total_points: p.total_points,
          selected_by_percent: Number(p.selected_by_percent),
          now_cost_tenths: p.now_cost, // FPL stores in 0.1m units
        };

        const existing = await client.query<{ bbs_id: string }>(
          `SELECT bbs_id FROM players WHERE external_ids->>'fpl' = $1 LIMIT 1`,
          [String(p.id)],
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE players
               SET team_id = COALESCE($1, team_id),
                   name = $2,
                   position = COALESCE($3, position),
                   headshot_url = COALESCE($4, headshot_url),
                   external_ids = external_ids
                     || jsonb_build_object('fpl', $5::text)
                     || jsonb_build_object('fpl_stats', $6::jsonb)
             WHERE bbs_id = $7`,
            [
              teamId,
              displayName,
              position,
              headshot,
              String(p.id),
              JSON.stringify(seasonStats),
              existing.rows[0].bbs_id,
            ],
          );
          upserts += 1;
        } else {
          const id = randomUUID();
          await client.query(
            `INSERT INTO players
               (bbs_id, team_id, name, position, headshot_url, external_ids)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              id,
              teamId,
              displayName,
              position,
              headshot,
              JSON.stringify({
                fpl: String(p.id),
                fpl_stats: seasonStats,
              }),
            ],
          );
          created += 1;
        }
      }

      console.log(`\n✓ done. ${created} new players, ${upserts} updated.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-fpl] fatal: ${msg}`);
  process.exit(1);
});
