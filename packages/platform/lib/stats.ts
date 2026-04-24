import { db } from './db.js';

/**
 * Per-match stats reads from match_stats + player_stats tables.
 * Stats are populated by `ingest-espn-stats.ts` (source='espn') and
 * `ingest-rundown.ts` (source='therundown', score field only).
 */

export interface TeamStatRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly teamLogoUrl: string | null;
  readonly field: string;
  readonly label: string | null;
  readonly displayValue: string | null;
  readonly source: string;
  readonly fetchedAt: Date;
}

export interface PlayerStatRow {
  readonly playerId: string;
  readonly playerName: string;
  readonly headshotUrl: string | null;
  readonly position: string | null;
  readonly jerseyNumber: string | null;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly stats: Record<string, { value: string; label: string | null }>;
}

interface DbTeamStat {
  team_id: string;
  team_name: string;
  team_logo_url: string | null;
  field: string;
  value: { display?: string | null; label?: string | null };
  source: string;
  fetched_at: Date;
}

interface DbPlayerStat {
  player_id: string;
  player_name: string;
  headshot_url: string | null;
  position: string | null;
  jersey_number: string | null;
  team_id: string | null;
  team_name: string | null;
  field: string;
  value: { value?: string; label?: string | null };
}

export async function listLatestTeamStats(matchId: string): Promise<TeamStatRow[]> {
  const result = await db().query<DbTeamStat>(
    `SELECT DISTINCT ON (ms.team_id, ms.field, ms.source)
       ms.team_id,
       t.name AS team_name,
       t.logo_url AS team_logo_url,
       ms.field,
       ms.value,
       ms.source,
       ms.fetched_at
     FROM match_stats ms
     JOIN teams t ON t.bbs_id = ms.team_id
     WHERE ms.match_id = $1
     ORDER BY ms.team_id, ms.field, ms.source, ms.fetched_at DESC`,
    [matchId],
  );
  return result.rows.map((r) => ({
    teamId: r.team_id,
    teamName: r.team_name,
    teamLogoUrl: r.team_logo_url,
    field: r.field,
    label: r.value?.label ?? null,
    displayValue: r.value?.display ?? null,
    source: r.source,
    fetchedAt: r.fetched_at,
  }));
}

export async function listPlayerStatsByMatch(
  matchId: string,
): Promise<PlayerStatRow[]> {
  const result = await db().query<DbPlayerStat>(
    `SELECT DISTINCT ON (ps.player_id, ps.field)
       ps.player_id,
       p.name AS player_name,
       p.headshot_url,
       p.position,
       p.jersey_number,
       p.team_id,
       t.name AS team_name,
       ps.field,
       ps.value
     FROM player_stats ps
     JOIN players p  ON p.bbs_id = ps.player_id
     LEFT JOIN teams t ON t.bbs_id = p.team_id
     WHERE ps.match_id = $1 AND ps.source = 'espn'
     ORDER BY ps.player_id, ps.field, ps.fetched_at DESC`,
    [matchId],
  );

  // Pivot stats by player
  const byPlayer = new Map<string, PlayerStatRow & { mutStats: Record<string, { value: string; label: string | null }> }>();
  for (const r of result.rows) {
    let row = byPlayer.get(r.player_id);
    if (!row) {
      const mutStats: Record<string, { value: string; label: string | null }> = {};
      row = {
        playerId: r.player_id,
        playerName: r.player_name,
        headshotUrl: r.headshot_url,
        position: r.position,
        jerseyNumber: r.jersey_number,
        teamId: r.team_id,
        teamName: r.team_name,
        stats: mutStats,
        mutStats,
      };
      byPlayer.set(r.player_id, row);
    }
    const v = r.value?.value;
    if (v !== undefined) {
      row.mutStats[r.field] = { value: String(v), label: r.value?.label ?? null };
    }
  }
  return Array.from(byPlayer.values()).map(({ mutStats: _m, ...rest }) => rest);
}
