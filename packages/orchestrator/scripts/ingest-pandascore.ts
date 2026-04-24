/**
 * PandaScore → Postgres esports ingest.
 *
 * Adds an entirely new sport to the platform: esports. PandaScore
 * covers CS2, LoL, Dota 2, Valorant, StarCraft, Rainbow Six, etc.
 *
 * Writes:
 *   - sports: ensures 'esports' slug exists (should already be seeded)
 *   - leagues: one per game+league combo (e.g. "LEC", "ESL Challenger")
 *   - teams: esports orgs
 *   - matches: upcoming + running matches
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-pandascore.ts
 *
 * Env:
 *   DATABASE_URL         (required)
 *   PANDASCORE_API_KEY   (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.pandascore.co';

interface PsTeam {
  id: number;
  name: string;
  acronym?: string | null;
  image_url?: string | null;
}

interface PsOpponent {
  type: string;
  opponent: PsTeam;
}

interface PsLeague {
  id: number;
  name: string;
  image_url?: string | null;
}

interface PsVideogame {
  id: number;
  name: string;
  slug: string;
}

interface PsMatch {
  id: number;
  name: string;
  begin_at: string;
  end_at?: string | null;
  status: string;
  league: PsLeague;
  videogame: PsVideogame;
  opponents: readonly PsOpponent[];
  results?: ReadonlyArray<{ team_id: number; score: number }>;
  winner_id?: number | null;
}

function psStatus(s: string): string {
  if (s === 'finished') return 'finished';
  if (s === 'running') return 'live';
  return 'scheduled';
}

async function ensureEsportsSport(c: import('pg').PoolClient): Promise<string> {
  const r = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM sports WHERE slug = 'esports' LIMIT 1`,
  );
  if (r.rows[0]) return r.rows[0].bbs_id;
  const id = randomUUID();
  await c.query(
    `INSERT INTO sports (bbs_id, name, slug) VALUES ($1, 'Esports', 'esports')`,
    [id],
  );
  return id;
}

async function upsertLeague(
  c: import('pg').PoolClient,
  sportId: string,
  league: PsLeague,
  videogame: PsVideogame,
): Promise<string> {
  const name = `${league.name} (${videogame.name})`;
  const season = String(new Date().getUTCFullYear());

  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM leagues WHERE sport_id = $1 AND name = $2 AND season = $3 LIMIT 1`,
    [sportId, name, season],
  );
  if (existing.rows[0]) return existing.rows[0].bbs_id;
  const id = randomUUID();
  await c.query(
    `INSERT INTO leagues (bbs_id, sport_id, name, country, season, external_ids)
       VALUES ($1, $2, $3, 'International', $4, $5::jsonb)`,
    [id, sportId, name, season, JSON.stringify({ pandascore_league: String(league.id), pandascore_game: videogame.slug })],
  );
  return id;
}

async function upsertTeam(
  c: import('pg').PoolClient,
  leagueId: string,
  team: PsTeam,
): Promise<string> {
  const byExt = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'pandascore' = $1 LIMIT 1`,
    [String(team.id)],
  );
  if (byExt.rows[0]) return byExt.rows[0].bbs_id;

  const id = randomUUID();
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, short_name, logo_url, external_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      id, leagueId, team.name, team.acronym ?? null, team.image_url ?? null,
      JSON.stringify({ pandascore: String(team.id) }),
    ],
  );
  return id;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['PANDASCORE_API_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('PANDASCORE_API_KEY is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const sportId = await ensureEsportsSport(client);

      // Fetch both running + upcoming — 100 per page.
      const allMatches: PsMatch[] = [];
      for (const kind of ['running', 'upcoming']) {
        for (let page = 1; page <= 3; page += 1) {
          const res = await fetch(`${BASE}/matches/${kind}?per_page=100&page=${page}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          });
          if (!res.ok) break;
          const body = (await res.json()) as readonly PsMatch[];
          if (body.length === 0) break;
          allMatches.push(...body);
          if (body.length < 100) break;
        }
      }
      console.log(`→ ${allMatches.length} esports matches from PandaScore`);

      let upserted = 0;
      for (const m of allMatches) {
        try {
          if (m.opponents.length < 2) continue;
          const leagueId = await upsertLeague(client, sportId, m.league, m.videogame);
          const team1 = await upsertTeam(client, leagueId, m.opponents[0]!.opponent);
          const team2 = await upsertTeam(client, leagueId, m.opponents[1]!.opponent);

          const scoreRow = m.results ?? [];
          const team1Score = scoreRow.find((r) => r.team_id === m.opponents[0]!.opponent.id)?.score ?? null;
          const team2Score = scoreRow.find((r) => r.team_id === m.opponents[1]!.opponent.id)?.score ?? null;

          const existing = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM matches WHERE external_ids->>'pandascore' = $1 LIMIT 1`,
            [String(m.id)],
          );

          if (existing.rows[0]) {
            await client.query(
              `UPDATE matches
                 SET status = $1, kickoff_utc = $2::timestamptz,
                     home_id = $3, away_id = $4, updated_at = NOW()
               WHERE bbs_id = $5`,
              [psStatus(m.status), m.begin_at, team2, team1, existing.rows[0].bbs_id],
            );
          } else {
            const id = randomUUID();
            await client.query(
              `INSERT INTO matches
                 (bbs_id, league_id, home_id, away_id, kickoff_utc, status,
                  sport_type, external_ids)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'esports', $7::jsonb)`,
              [
                id, leagueId, team2, team1, m.begin_at, psStatus(m.status),
                JSON.stringify({
                  pandascore: String(m.id),
                  videogame: m.videogame.slug,
                  match_name: m.name,
                }),
              ],
            );
          }

          // Record final scores as match_stats if available.
          if (team1Score !== null && team2Score !== null) {
            const matchRow = existing.rows[0] ?? (
              await client.query<{ bbs_id: string }>(
                `SELECT bbs_id FROM matches WHERE external_ids->>'pandascore' = $1 LIMIT 1`,
                [String(m.id)],
              )
            ).rows[0];
            if (matchRow) {
              await client.query(
                `DELETE FROM match_stats WHERE match_id = $1 AND source = 'pandascore'`,
                [matchRow.bbs_id],
              );
              await client.query(
                `INSERT INTO match_stats (match_id, team_id, field, value, source, confidence, fetched_at)
                 VALUES ($1, $2, 'score', $3::jsonb, 'pandascore', 0.95, NOW()),
                        ($1, $4, 'score', $5::jsonb, 'pandascore', 0.95, NOW())`,
                [
                  matchRow.bbs_id,
                  team1, JSON.stringify({ display: String(team1Score) }),
                  team2, JSON.stringify({ display: String(team2Score) }),
                ],
              );
            }
          }
          upserted += 1;
        } catch (err) {
          console.error(`  ✗ match ${m.id}: ${err instanceof Error ? err.message : err}`);
        }
      }

      console.log(`\n✓ done. ${upserted} esports matches upserted.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-pandascore] fatal: ${msg}`);
  process.exit(1);
});
