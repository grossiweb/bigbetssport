import { db } from './db.js';

export interface StandingRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly logoUrl: string | null;
  readonly rank: number | null;
  readonly wins: number | null;
  readonly losses: number | null;
  readonly ties: number | null;
  readonly winPct: number | null;
  readonly gamesPlayed: number | null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  readonly streak: string | null;
  readonly updatedAt: Date;
}

export interface StandingsGroup {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly sportType: string;
  readonly season: string;
  readonly rows: readonly StandingRow[];
}

interface DbStandingRow {
  league_id: string;
  league_name: string;
  sport_type: string;
  season: string;
  team_id: string;
  team_name: string;
  logo_url: string | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  win_pct: string | null;
  games_played: number | null;
  points_for: string | null;
  points_against: string | null;
  streak: string | null;
  updated_at: Date;
}

export async function listStandingsByLeague(
  filter: { leagueName?: string; sport?: string } = {},
): Promise<StandingsGroup[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.leagueName) {
    params.push(filter.leagueName);
    where.push(`l.name = $${params.length}`);
  }
  if (filter.sport) {
    params.push(filter.sport);
    where.push(`s.slug = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db().query<DbStandingRow>(
    `SELECT
       l.bbs_id          AS league_id,
       l.name            AS league_name,
       s.slug            AS sport_type,
       st.season         AS season,
       t.bbs_id          AS team_id,
       t.name            AS team_name,
       t.logo_url        AS logo_url,
       st.rank,
       st.wins, st.losses, st.ties, st.win_pct::text AS win_pct,
       st.games_played,
       st.points_for::text AS points_for,
       st.points_against::text AS points_against,
       st.streak, st.updated_at
     FROM standings st
     JOIN leagues l ON l.bbs_id = st.league_id
     JOIN sports  s ON s.bbs_id = l.sport_id
     JOIN teams   t ON t.bbs_id = st.team_id
     ${whereSql}
     ORDER BY l.name, st.rank ASC NULLS LAST, st.wins DESC NULLS LAST`,
    params,
  );

  const byLeague = new Map<string, StandingsGroup & { mut: StandingRow[] }>();
  for (const r of rows) {
    let g = byLeague.get(r.league_id);
    if (!g) {
      const mut: StandingRow[] = [];
      g = {
        leagueId: r.league_id,
        leagueName: r.league_name,
        sportType: r.sport_type,
        season: r.season,
        rows: mut,
        mut,
      };
      byLeague.set(r.league_id, g);
    }
    g.mut.push({
      teamId: r.team_id,
      teamName: r.team_name,
      logoUrl: r.logo_url,
      rank: r.rank,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      winPct: r.win_pct !== null ? Number(r.win_pct) : null,
      gamesPlayed: r.games_played,
      pointsFor: r.points_for !== null ? Number(r.points_for) : null,
      pointsAgainst: r.points_against !== null ? Number(r.points_against) : null,
      streak: r.streak,
      updatedAt: r.updated_at,
    });
  }
  return Array.from(byLeague.values()).map(({ mut: _mut, ...g }) => g);
}

export async function listStandingsLeagues(): Promise<
  Array<{ name: string; sport: string; teamCount: number }>
> {
  const { rows } = await db().query<{ name: string; sport: string; c: string }>(
    `SELECT l.name, s.slug AS sport, COUNT(*)::text AS c
       FROM standings st
       JOIN leagues l ON l.bbs_id = st.league_id
       JOIN sports  s ON s.bbs_id = l.sport_id
       GROUP BY l.name, s.slug
       ORDER BY s.slug, l.name`,
  );
  return rows.map((r) => ({
    name: r.name,
    sport: r.sport,
    teamCount: Number(r.c),
  }));
}
