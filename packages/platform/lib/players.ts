import { db } from './db.js';

export interface PlayerRow {
  readonly id: string;
  readonly name: string;
  readonly position: string | null;
  readonly nationality: string | null;
  readonly jerseyNumber: string | null;
  readonly height: string | null;
  readonly weight: string | null;
  readonly headshotUrl: string | null;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamLogoUrl: string | null;
  readonly leagueName: string | null;
  readonly sportType: string | null;
}

interface DbPlayerRow {
  id: string;
  name: string;
  position: string | null;
  nationality: string | null;
  jersey_number: string | null;
  height: string | null;
  weight: string | null;
  headshot_url: string | null;
  team_id: string | null;
  team_name: string | null;
  team_logo_url: string | null;
  league_name: string | null;
  sport_type: string | null;
}

export async function listPlayers(opts: {
  sport?: string;
  team?: string;
  league?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<PlayerRow[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.sport) {
    params.push(opts.sport);
    where.push(`s.slug = $${params.length}`);
  }
  if (opts.team) {
    params.push(opts.team);
    where.push(`t.bbs_id = $${params.length}::uuid`);
  }
  if (opts.league) {
    params.push(opts.league);
    where.push(`l.name = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await db().query<DbPlayerRow>(
    `SELECT
       p.bbs_id         AS id,
       p.name,
       p.position,
       p.nationality,
       p.jersey_number,
       p.height,
       p.weight,
       p.headshot_url,
       t.bbs_id         AS team_id,
       t.name           AS team_name,
       t.logo_url       AS team_logo_url,
       l.name           AS league_name,
       s.slug           AS sport_type
     FROM players p
     LEFT JOIN teams   t ON t.bbs_id = p.team_id
     LEFT JOIN leagues l ON l.bbs_id = t.league_id
     LEFT JOIN sports  s ON s.bbs_id = l.sport_id
     ${whereSql}
     ORDER BY p.name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return result.rows.map(rowToPlayer);
}

export async function countPlayers(opts: {
  sport?: string;
  team?: string;
  league?: string;
  search?: string;
} = {}): Promise<number> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.sport) {
    params.push(opts.sport);
    where.push(`s.slug = $${params.length}`);
  }
  if (opts.team) {
    params.push(opts.team);
    where.push(`t.bbs_id = $${params.length}::uuid`);
  }
  if (opts.league) {
    params.push(opts.league);
    where.push(`l.name = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const r = await db().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM players p
       LEFT JOIN teams   t ON t.bbs_id = p.team_id
       LEFT JOIN leagues l ON l.bbs_id = t.league_id
       LEFT JOIN sports  s ON s.bbs_id = l.sport_id
     ${whereSql}`,
    params,
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function listPlayerSports(): Promise<
  Array<{ sport: string; count: number }>
> {
  const r = await db().query<{ sport: string; c: string }>(
    `SELECT s.slug AS sport, COUNT(*)::text AS c
       FROM players p
       JOIN teams t   ON t.bbs_id = p.team_id
       JOIN leagues l ON l.bbs_id = t.league_id
       JOIN sports  s ON s.bbs_id = l.sport_id
      GROUP BY s.slug
      ORDER BY c DESC`,
  );
  return r.rows.map((row) => ({ sport: row.sport, count: Number(row.c) }));
}

function rowToPlayer(r: DbPlayerRow): PlayerRow {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    nationality: r.nationality,
    jerseyNumber: r.jersey_number,
    height: r.height,
    weight: r.weight,
    headshotUrl: r.headshot_url,
    teamId: r.team_id,
    teamName: r.team_name,
    teamLogoUrl: r.team_logo_url,
    leagueName: r.league_name,
    sportType: r.sport_type,
  };
}
