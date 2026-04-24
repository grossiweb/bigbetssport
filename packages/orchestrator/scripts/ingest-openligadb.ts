/**
 * OpenLigaDB → Postgres. Bundesliga match + goal events.
 *
 * api.openligadb.de is free + unkeyed. Fills a gap our ESPN ingest has:
 * ESPN's soccer shape doesn't expose boxscore.players, so we get no per-
 * player stats for European soccer. OpenLigaDB gives us the goal scorer
 * for every Bundesliga goal — we store those as scoring match_events.
 *
 * Writes:
 *   - matches: upserts via external_ids.openligadb
 *   - match_events: one row per goal (source='openligadb', scoring_play=true)
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-openligadb.ts [--season 2024] [--league bl1]
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.openligadb.de';

interface OldbTeam {
  teamId: number;
  teamName: string;
  shortName?: string;
  teamIconUrl?: string;
}

interface OldbGoal {
  goalID: number;
  scoreTeam1: number;
  scoreTeam2: number;
  matchMinute: number | null;
  goalGetterName: string;
  goalGetterID?: number;
  isPenalty?: boolean;
  isOwnGoal?: boolean;
}

interface OldbMatchResult {
  resultTypeID: number;
  pointsTeam1: number;
  pointsTeam2: number;
}

interface OldbMatch {
  matchID: number;
  matchDateTime: string;
  timeZoneID?: string;
  leagueId?: number;
  leagueName?: string;
  leagueSeason?: number;
  team1: OldbTeam;
  team2: OldbTeam;
  matchResults?: readonly OldbMatchResult[];
  goals?: readonly OldbGoal[];
  matchIsFinished?: boolean;
}

// OpenLigaDB league key → our leagues.name.
const LEAGUE_MAP: Record<string, string> = {
  bl1: 'Bundesliga',
};

async function findOrCreateTeam(
  c: import('pg').PoolClient,
  leagueId: string,
  team: OldbTeam,
): Promise<string> {
  // Try external id first.
  const byExt = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams WHERE external_ids->>'openligadb' = $1 LIMIT 1`,
    [String(team.teamId)],
  );
  if (byExt.rows[0]) return byExt.rows[0].bbs_id;

  // Then name.
  const byName = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams
       WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [leagueId, team.teamName],
  );
  if (byName.rows[0]) {
    await c.query(
      `UPDATE teams
         SET external_ids = external_ids || jsonb_build_object('openligadb', $1::text),
             logo_url = COALESCE(logo_url, $2)
       WHERE bbs_id = $3`,
      [String(team.teamId), team.teamIconUrl ?? null, byName.rows[0].bbs_id],
    );
    return byName.rows[0].bbs_id;
  }

  const id = randomUUID();
  await c.query(
    `INSERT INTO teams
       (bbs_id, league_id, name, short_name, logo_url, external_ids)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      id,
      leagueId,
      team.teamName,
      team.shortName ?? null,
      team.teamIconUrl ?? null,
      JSON.stringify({ openligadb: String(team.teamId) }),
    ],
  );
  return id;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const args = process.argv.slice(2);
  function flag(name: string): string | undefined {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('--')) return undefined;
    return v;
  }
  const season = flag('--season') ?? String(new Date().getUTCFullYear());
  const leagueKey = flag('--league') ?? 'bl1';

  const pool = new Pool({ connectionString: url, max: 1, keepAlive: true });

  try {
    const client = await pool.connect();
    try {
      const ourLeagueName = LEAGUE_MAP[leagueKey] ?? 'Bundesliga';
      const lg = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM leagues WHERE name = $1 LIMIT 1`,
        [ourLeagueName],
      );
      const leagueId = lg.rows[0]?.bbs_id;
      if (!leagueId) throw new Error(`league not found: ${ourLeagueName}`);

      console.log(`→ fetching ${leagueKey} ${season} matches…`);
      const res = await fetch(`${BASE}/getmatchdata/${leagueKey}/${season}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const matches = (await res.json()) as readonly OldbMatch[];
      console.log(`  ${matches.length} matches`);

      let matchesUpserted = 0;
      let goalsInserted = 0;

      for (const m of matches) {
        try {
          const homeId = await findOrCreateTeam(client, leagueId, m.team1);
          const awayId = await findOrCreateTeam(client, leagueId, m.team2);

          // Final score: "Endergebnis" typically resultTypeID=2, fallback to last one.
          const endResult =
            m.matchResults?.find((r) => r.resultTypeID === 2) ??
            m.matchResults?.[m.matchResults.length - 1];
          const homeScore = endResult?.pointsTeam1 ?? null;
          const awayScore = endResult?.pointsTeam2 ?? null;
          const status = m.matchIsFinished ? 'finished' : 'scheduled';

          // Linescore from halftime (resultTypeID=1) if present.
          const ht = m.matchResults?.find((r) => r.resultTypeID === 1);
          const linescore =
            endResult && ht
              ? JSON.stringify({
                  home: [ht.pointsTeam1, endResult.pointsTeam1 - ht.pointsTeam1],
                  away: [ht.pointsTeam2, endResult.pointsTeam2 - ht.pointsTeam2],
                })
              : null;

          const existing = await client.query<{ bbs_id: string }>(
            `SELECT bbs_id FROM matches WHERE external_ids->>'openligadb' = $1 LIMIT 1`,
            [String(m.matchID)],
          );
          let matchId: string;
          if (existing.rows[0]) {
            matchId = existing.rows[0].bbs_id;
            await client.query(
              `UPDATE matches
                 SET status = $1,
                     kickoff_utc = $2::timestamptz,
                     home_id = $3, away_id = $4,
                     linescore = COALESCE($5::jsonb, linescore),
                     updated_at = NOW()
               WHERE bbs_id = $6`,
              [status, m.matchDateTime, homeId, awayId, linescore, matchId],
            );
          } else {
            matchId = randomUUID();
            await client.query(
              `INSERT INTO matches
                 (bbs_id, league_id, home_id, away_id, kickoff_utc, status,
                  sport_type, linescore, external_ids)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'football', $7::jsonb, $8::jsonb)`,
              [
                matchId,
                leagueId,
                homeId,
                awayId,
                m.matchDateTime,
                status,
                linescore,
                JSON.stringify({ openligadb: String(m.matchID) }),
              ],
            );
          }
          matchesUpserted += 1;

          // Record goals as scoring match_events (source='openligadb').
          if (m.goals && m.goals.length > 0) {
            await client.query(
              `DELETE FROM match_events WHERE match_id = $1 AND source = 'openligadb'`,
              [matchId],
            );
            let seq = 0;
            for (const g of m.goals) {
              seq += 1;
              const desc = [
                g.goalGetterName,
                g.isPenalty ? '(pen)' : null,
                g.isOwnGoal ? '(own goal)' : null,
              ]
                .filter(Boolean)
                .join(' ');
              await client.query(
                `INSERT INTO match_events
                   (match_id, source, external_id, sequence_number, period, period_display,
                    clock, type, description, scoring_play, score_value,
                    home_score, away_score)
                 VALUES ($1, 'openligadb', $2, $3, $4, $5, $6, 'Goal', $7, TRUE, 1, $8, $9)
                 ON CONFLICT (match_id, source, external_id) DO NOTHING`,
                [
                  matchId,
                  String(g.goalID),
                  seq,
                  g.matchMinute !== null && g.matchMinute > 45 ? 2 : 1,
                  g.matchMinute !== null && g.matchMinute > 45 ? '2nd Half' : '1st Half',
                  g.matchMinute !== null ? `${g.matchMinute}'` : null,
                  desc || null,
                  g.scoreTeam1,
                  g.scoreTeam2,
                ],
              );
              goalsInserted += 1;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ match ${m.matchID}: ${msg}`);
        }
      }

      console.log(
        `\n✓ done. ${matchesUpserted} matches upserted, ${goalsInserted} goals recorded.`,
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
  console.error(`[ingest-openligadb] fatal: ${msg}`);
  process.exit(1);
});
