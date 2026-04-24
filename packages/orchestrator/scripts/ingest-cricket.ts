/**
 * CricketData (cricapi.com) → Postgres cricket ingest.
 *
 * Fills the cricket gap: no Rundown cricket detail, no ESPN cricket
 * coverage for us. CricketData gives current + upcoming matches with
 * team meta, innings scores, venue, and date.
 *
 * Writes:
 *   - teams: one per cricket country / franchise (linked to IPL or T20I Cricket league)
 *   - matches: upserted via external_ids.cricketdata
 *   - linescore: innings r/w/o stored as linescore JSONB
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-cricket.ts
 *
 * Env:
 *   DATABASE_URL        (required)
 *   CRICKETDATA_API_KEY (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.cricapi.com/v1';

interface CricTeamInfo {
  name: string;
  shortname?: string;
  img?: string;
}

interface CricScore {
  r: number;
  w: number;
  o: number;
  inning: string;
}

interface CricMatch {
  id: string;
  name: string;
  matchType: string;
  status: string;
  venue?: string;
  date: string;           // YYYY-MM-DD
  dateTimeGMT?: string;   // full ISO
  teams: readonly string[];
  teamInfo?: readonly CricTeamInfo[];
  score?: readonly CricScore[];
  series_id?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
}

function matchTypeToLeague(type: string, name: string): string {
  const n = name.toLowerCase();
  if (n.includes('ipl')) return 'IPL';
  if (type === 'test') return 'Test Cricket';
  if (type === 'odi') return 'ODI Cricket';
  // t20, t20i, t10 → T20I Cricket (closest match in our seed)
  return 'T20I Cricket';
}

function matchStatus(m: CricMatch): string {
  if (m.matchEnded) return 'finished';
  if (m.matchStarted) return 'live';
  return 'scheduled';
}

async function findOrCreateTeam(
  c: import('pg').PoolClient,
  leagueId: string,
  info: CricTeamInfo,
): Promise<string> {
  const byExt = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'cricketdata' = $1 LIMIT 1`,
    [info.name],
  );
  if (byExt.rows[0]) return byExt.rows[0].bbs_id;

  const byName = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams
       WHERE LOWER(name) = LOWER($1) AND league_id = $2 LIMIT 1`,
    [info.name, leagueId],
  );
  if (byName.rows[0]) {
    await c.query(
      `UPDATE teams
         SET external_ids = external_ids || jsonb_build_object('cricketdata', $1::text),
             logo_url = COALESCE(logo_url, $2)
       WHERE bbs_id = $3`,
      [info.name, info.img ?? null, byName.rows[0].bbs_id],
    );
    return byName.rows[0].bbs_id;
  }

  const id = randomUUID();
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, short_name, logo_url, external_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, leagueId, info.name, info.shortname ?? null, info.img ?? null, JSON.stringify({ cricketdata: info.name })],
  );
  return id;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const apiKey = process.env['CRICKETDATA_API_KEY'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (!apiKey) throw new Error('CRICKETDATA_API_KEY is required');

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      // Fetch both current + series-upcoming matches via paging.
      const allMatches: CricMatch[] = [];
      for (let offset = 0; offset < 100; offset += 25) {
        const res = await fetch(`${BASE}/currentMatches?apikey=${apiKey}&offset=${offset}`);
        if (!res.ok) break;
        const body = (await res.json()) as { data?: readonly CricMatch[]; status?: string };
        const batch = body.data ?? [];
        if (batch.length === 0) break;
        allMatches.push(...batch);
        if (batch.length < 25) break;
      }
      console.log(`→ ${allMatches.length} cricket matches from CricketData`);

      // Pre-load league ids.
      const leagueMap = new Map<string, string>();
      const lgRes = await client.query<{ bbs_id: string; name: string }>(
        `SELECT l.bbs_id, l.name FROM leagues l
           JOIN sports s ON s.bbs_id = l.sport_id
          WHERE s.slug = 'cricket'`,
      );
      for (const r of lgRes.rows) leagueMap.set(r.name, r.bbs_id);

      let matchesUpserted = 0;
      let teamsCreated = 0;

      for (const m of allMatches) {
        try {
          const leagueName = matchTypeToLeague(m.matchType, m.name);
          const leagueId = leagueMap.get(leagueName);
          if (!leagueId) {
            console.log(`  ? skip ${m.id}: league ${leagueName} not seeded`);
            continue;
          }
          const infos = m.teamInfo ?? m.teams.map((name) => ({ name }));
          if (infos.length < 2) continue;
          const home = await findOrCreateTeam(client, leagueId, infos[1]!);
          const away = await findOrCreateTeam(client, leagueId, infos[0]!);

          // Aggregate scores by inning → linescore-like structure.
          const scores = m.score ?? [];
          const awayRuns = scores
            .filter((s) => s.inning.toLowerCase().startsWith(infos[0]!.name.toLowerCase()))
            .map((s) => s.r);
          const homeRuns = scores
            .filter((s) => s.inning.toLowerCase().startsWith(infos[1]!.name.toLowerCase()))
            .map((s) => s.r);

          const linescore =
            homeRuns.length > 0 || awayRuns.length > 0
              ? JSON.stringify({ home: homeRuns, away: awayRuns })
              : null;

          const kickoff = m.dateTimeGMT ?? `${m.date}T00:00:00Z`;

          const existing = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM matches WHERE external_ids->>'cricketdata' = $1 LIMIT 1`,
            [m.id],
          );
          if (existing.rows[0]) {
            await client.query(
              `UPDATE matches
                 SET status = $1, kickoff_utc = $2::timestamptz,
                     home_id = $3, away_id = $4,
                     linescore = COALESCE($5::jsonb, linescore),
                     updated_at = NOW()
               WHERE bbs_id = $6`,
              [matchStatus(m), kickoff, home, away, linescore, existing.rows[0].bbs_id],
            );
          } else {
            const id = randomUUID();
            await client.query(
              `INSERT INTO matches
                 (bbs_id, league_id, home_id, away_id, kickoff_utc, status,
                  sport_type, linescore, external_ids)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'cricket', $7::jsonb, $8::jsonb)`,
              [
                id, leagueId, home, away, kickoff, matchStatus(m),
                linescore,
                JSON.stringify({
                  cricketdata: m.id,
                  matchType: m.matchType,
                  seriesName: m.name,
                  venue: m.venue,
                }),
              ],
            );
          }
          matchesUpserted += 1;
        } catch (err) {
          console.error(`  ✗ match ${m.id}: ${err instanceof Error ? err.message : err}`);
        }
      }

      console.log(`\n✓ done. ${matchesUpserted} cricket matches upserted.`);
      void teamsCreated;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-cricket] fatal: ${msg}`);
  process.exit(1);
});
