/**
 * football-data.org → Postgres. Adds European club competitions Rundown
 * doesn't cover: UEFA Champions League, UEFA Europa League, plus
 * enrichment for the top-5 domestic leagues we already have.
 *
 * Writes matches + team logos for: CL, EL, EC (Euros), WC (World Cup),
 * as well as PL, BL1, SA, FL1, PD (mirroring our Rundown coverage).
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-football-data.ts
 *
 * Env:
 *   DATABASE_URL         (required)
 *   FOOTBALL_DATA_KEY    (required, free tier: 10 calls/minute)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.football-data.org/v4';
const DELAY_MS = 6500; // 10 calls/min free-tier

// football-data.org competition code → our leagues.name
const COMPETITIONS: ReadonlyArray<{ code: string; name: string; season: string }> = [
  { code: 'CL',  name: 'UEFA Champions League', season: '2025-26' },
  { code: 'EL',  name: 'UEFA Europa League',    season: '2025-26' },
  { code: 'PL',  name: 'EPL',                   season: '2025-26' },
  { code: 'BL1', name: 'Bundesliga',            season: '2025-26' },
  { code: 'SA',  name: 'Serie A',               season: '2025-26' },
  { code: 'FL1', name: 'Ligue 1',               season: '2025-26' },
  { code: 'PD',  name: 'La Liga',               season: '2025-26' },
];

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;          // SCHEDULED, LIVE, FINISHED, POSTPONED, CANCELLED
  homeTeam: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
  awayTeam: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
  score?: {
    fullTime?: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
  };
  competition: { name: string };
}

function fdStatus(s: string): string {
  if (s === 'FINISHED') return 'finished';
  if (s === 'LIVE' || s === 'IN_PLAY' || s === 'PAUSED') return 'live';
  if (s === 'POSTPONED' || s === 'CANCELLED' || s === 'SUSPENDED') return 'cancelled';
  return 'scheduled';
}

async function ensureLeague(
  c: import('pg').PoolClient,
  name: string,
  season: string,
): Promise<string> {
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM leagues WHERE name = $1 LIMIT 1`,
    [name],
  );
  if (existing.rows[0]) return existing.rows[0].bbs_id;

  const sp = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM sports WHERE slug = 'football' LIMIT 1`,
  );
  const sportId = sp.rows[0]?.bbs_id;
  if (!sportId) throw new Error('football sport not seeded');

  const id = randomUUID();
  await c.query(
    `INSERT INTO leagues (bbs_id, sport_id, name, country, season, external_ids)
       VALUES ($1, $2, $3, 'Europe', $4, '{}'::jsonb)`,
    [id, sportId, name, season],
  );
  return id;
}

async function upsertTeam(
  c: import('pg').PoolClient,
  leagueId: string,
  team: FdMatch['homeTeam'],
): Promise<string> {
  const byExt = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'football-data' = $1 LIMIT 1`,
    [String(team.id)],
  );
  if (byExt.rows[0]) return byExt.rows[0].bbs_id;
  const byName = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams
       WHERE LOWER(name) = LOWER($1) OR LOWER(name) = LOWER($2) LIMIT 1`,
    [team.name, team.shortName ?? ''],
  );
  if (byName.rows[0]) {
    await c.query(
      `UPDATE teams
         SET external_ids = external_ids || jsonb_build_object('football-data', $1::text),
             logo_url = COALESCE(logo_url, $2)
       WHERE bbs_id = $3`,
      [String(team.id), team.crest ?? null, byName.rows[0].bbs_id],
    );
    return byName.rows[0].bbs_id;
  }
  const id = randomUUID();
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, short_name, logo_url, external_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, leagueId, team.name, team.tla ?? team.shortName ?? null, team.crest ?? null, JSON.stringify({ 'football-data': String(team.id) })],
  );
  return id;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['FOOTBALL_DATA_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('FOOTBALL_DATA_KEY is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });
  try {
    const client = await pool.connect();
    try {
      let totalMatches = 0;
      for (const comp of COMPETITIONS) {
        process.stdout.write(`· ${comp.name} … `);
        try {
          const res = await fetch(
            `${BASE}/competitions/${comp.code}/matches?season=${comp.season.slice(0, 4)}`,
            { headers: { 'X-Auth-Token': apiKey } },
          );
          if (!res.ok) {
            console.log(`✗ HTTP ${res.status}`);
            await new Promise((r) => setTimeout(r, DELAY_MS));
            continue;
          }
          const body = (await res.json()) as { matches?: readonly FdMatch[] };
          const matches = body.matches ?? [];
          const leagueId = await ensureLeague(client, comp.name, comp.season);
          let c = 0;
          for (const m of matches) {
            try {
              const home = await upsertTeam(client, leagueId, m.homeTeam);
              const away = await upsertTeam(client, leagueId, m.awayTeam);
              const ft = m.score?.fullTime;
              const ht = m.score?.halfTime;
              const linescore =
                ft?.home !== null && ft?.away !== null && ht?.home !== null && ht?.away !== null
                  ? JSON.stringify({
                      home: [ht!.home!, ft!.home! - ht!.home!],
                      away: [ht!.away!, ft!.away! - ht!.away!],
                    })
                  : null;

              const existing = await client.query<{ bbs_id: string }>(
                `SELECT bbs_id FROM matches WHERE external_ids->>'football-data' = $1 LIMIT 1`,
                [String(m.id)],
              );
              if (existing.rows[0]) {
                await client.query(
                  `UPDATE matches
                     SET status = $1, kickoff_utc = $2::timestamptz,
                         home_id = $3, away_id = $4,
                         linescore = COALESCE($5::jsonb, linescore),
                         updated_at = NOW()
                   WHERE bbs_id = $6`,
                  [fdStatus(m.status), m.utcDate, home, away, linescore, existing.rows[0].bbs_id],
                );
              } else {
                const id = randomUUID();
                await client.query(
                  `INSERT INTO matches
                     (bbs_id, league_id, home_id, away_id, kickoff_utc, status,
                      sport_type, linescore, external_ids)
                   VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'football', $7::jsonb, $8::jsonb)`,
                  [
                    id, leagueId, home, away, m.utcDate, fdStatus(m.status),
                    linescore, JSON.stringify({ 'football-data': String(m.id) }),
                  ],
                );
              }
              c += 1;
            } catch (err) {
              console.error(`    ✗ match ${m.id}: ${err instanceof Error ? err.message : err}`);
            }
          }
          totalMatches += c;
          console.log(`${c} matches`);
        } catch (err) {
          console.log(`✗ ${err instanceof Error ? err.message : err}`);
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      console.log(`\n✓ done. ${totalMatches} matches upserted total.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-football-data] fatal: ${msg}`);
  process.exit(1);
});
