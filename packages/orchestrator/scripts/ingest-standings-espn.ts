/**
 * ESPN → Postgres standings ingest.
 *
 * Hits ESPN's public site API (no auth) for each supported league and
 * upserts a row into `standings` per team.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-standings-espn.ts [--league NBA|MLB|...|all]
 *
 * Env:
 *   DATABASE_URL   (required)
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

interface LeagueMapping {
  readonly leagueName: string;       // matches leagues.name in our DB
  readonly espnSport: string;        // URL segment, e.g. "basketball"
  readonly espnLeague: string;       // URL segment, e.g. "nba"
  readonly season: string;           // our season label
}

const LEAGUE_MAP: readonly LeagueMapping[] = [
  { leagueName: 'NBA',        espnSport: 'basketball', espnLeague: 'nba',   season: '2025-26' },
  { leagueName: 'NFL',        espnSport: 'football',   espnLeague: 'nfl',   season: '2025' },
  { leagueName: 'NCAAF',      espnSport: 'football',   espnLeague: 'college-football', season: '2025' },
  { leagueName: 'MLB',        espnSport: 'baseball',   espnLeague: 'mlb',   season: '2026' },
  { leagueName: 'NHL',        espnSport: 'hockey',     espnLeague: 'nhl',   season: '2025-26' },
  { leagueName: 'EPL',        espnSport: 'soccer',     espnLeague: 'eng.1', season: '2025-26' },
  { leagueName: 'La Liga',    espnSport: 'soccer',     espnLeague: 'esp.1', season: '2025-26' },
  { leagueName: 'Bundesliga', espnSport: 'soccer',     espnLeague: 'ger.1', season: '2025-26' },
  { leagueName: 'Serie A',    espnSport: 'soccer',     espnLeague: 'ita.1', season: '2025-26' },
  { leagueName: 'Ligue 1',    espnSport: 'soccer',     espnLeague: 'fra.1', season: '2025-26' },
  { leagueName: 'MLS',        espnSport: 'soccer',     espnLeague: 'usa.1', season: '2026' },
];

// ---- ESPN response shapes (subset) --------------------------------------
interface EspnStat {
  name: string;
  value: number | null;
  displayValue: string;
}

interface EspnTeam {
  id: string;
  abbreviation?: string;
  displayName: string;
  location?: string;
  name?: string;
}

interface EspnEntry {
  team: EspnTeam;
  stats: readonly EspnStat[];
}

interface EspnStandings {
  entries: readonly EspnEntry[];
}

interface EspnGroup {
  name?: string;
  isConference?: boolean;
  standings?: EspnStandings;
  children?: readonly EspnGroup[];
}

interface EspnResponse {
  name?: string;
  standings?: EspnStandings;
  children?: readonly EspnGroup[];
}

// ---- Stat extraction -----------------------------------------------------
function statByName(stats: readonly EspnStat[], name: string): number | null {
  const s = stats.find((x) => x.name === name);
  if (!s || s.value === null || s.value === undefined) return null;
  return s.value;
}

function statDisplay(stats: readonly EspnStat[], name: string): string | null {
  const s = stats.find((x) => x.name === name);
  return s?.displayValue ?? null;
}

// Walk the nested group tree to collect ALL entries across conferences/divisions.
function collectEntries(node: EspnResponse | EspnGroup): readonly EspnEntry[] {
  const out: EspnEntry[] = [];
  if (node.standings?.entries) {
    for (const e of node.standings.entries) out.push(e);
  }
  const children = 'children' in node ? node.children : undefined;
  if (children) {
    for (const c of children) {
      for (const e of collectEntries(c)) out.push(e);
    }
  }
  return out;
}

// ---- DB helpers ----------------------------------------------------------
async function getLeagueId(c: Client, leagueName: string): Promise<string | null> {
  const r = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM leagues WHERE name = $1 LIMIT 1`,
    [leagueName],
  );
  return r.rows[0]?.bbs_id ?? null;
}

async function findOrCreateTeamId(
  c: Client,
  leagueId: string,
  espnEntry: EspnEntry,
): Promise<string> {
  // 1) Try ESPN id if we've stored it in external_ids.espn
  const byEspn = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM teams
       WHERE league_id = $1 AND external_ids->>'espn' = $2 LIMIT 1`,
    [leagueId, espnEntry.team.id],
  );
  if (byEspn.rows[0]) {
    // Backfill external_ids.espn on existing row too
    return byEspn.rows[0].bbs_id;
  }

  // 2) Match by display name (case-insensitive)
  const displayName = espnEntry.team.displayName;
  const byName = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id, external_ids FROM teams
       WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [leagueId, displayName],
  );
  if (byName.rows[0]) {
    // Backfill espn id
    await c.query(
      `UPDATE teams
         SET external_ids = external_ids || jsonb_build_object('espn', $1::text)
       WHERE bbs_id = $2`,
      [espnEntry.team.id, byName.rows[0].bbs_id],
    );
    return byName.rows[0].bbs_id;
  }

  // 3) Match by location + name concat ("Oklahoma City Thunder")
  if (espnEntry.team.location && espnEntry.team.name) {
    const concat = `${espnEntry.team.location} ${espnEntry.team.name}`;
    const byConcat = await c.query<{ bbs_id: string }>(
      `SELECT bbs_id FROM teams
         WHERE league_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [leagueId, concat],
    );
    if (byConcat.rows[0]) {
      await c.query(
        `UPDATE teams
           SET external_ids = external_ids || jsonb_build_object('espn', $1::text)
         WHERE bbs_id = $2`,
        [espnEntry.team.id, byConcat.rows[0].bbs_id],
      );
      return byConcat.rows[0].bbs_id;
    }
  }

  // 4) Create the team. We don't have therundown id but we have espn id +
  //    display name. The Rundown ingest or TheSportsDB enrichment will
  //    fill in logo_url and therundown id if the team eventually appears.
  const id = randomUUID();
  const extIds = JSON.stringify({ espn: espnEntry.team.id });
  await c.query(
    `INSERT INTO teams (bbs_id, league_id, name, short_name, external_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      id,
      leagueId,
      displayName,
      espnEntry.team.abbreviation ?? null,
      extIds,
    ],
  );
  return id;
}

async function upsertStanding(
  c: Client,
  leagueId: string,
  teamId: string,
  season: string,
  entry: EspnEntry,
  rank: number,
): Promise<void> {
  const wins = statByName(entry.stats, 'wins');
  const losses = statByName(entry.stats, 'losses');
  const ties = statByName(entry.stats, 'ties') ?? 0;
  const winPct = statByName(entry.stats, 'winpercent');
  const pointsFor = statByName(entry.stats, 'pointsfor');
  const pointsAgainst = statByName(entry.stats, 'pointsagainst');
  const gamesPlayed = statByName(entry.stats, 'gamesplayed') ??
    (wins !== null && losses !== null ? wins + losses + (ties ?? 0) : null);
  const streak = statDisplay(entry.stats, 'streak');

  await c.query(
    `INSERT INTO standings
       (league_id, team_id, season, rank, games_played, wins, losses, ties,
        win_pct, points_for, points_against, streak, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'espn', NOW())
     ON CONFLICT (league_id, team_id, season, source) DO UPDATE
       SET rank = EXCLUDED.rank,
           games_played = EXCLUDED.games_played,
           wins = EXCLUDED.wins,
           losses = EXCLUDED.losses,
           ties = EXCLUDED.ties,
           win_pct = EXCLUDED.win_pct,
           points_for = EXCLUDED.points_for,
           points_against = EXCLUDED.points_against,
           streak = EXCLUDED.streak,
           updated_at = NOW()`,
    [
      leagueId,
      teamId,
      season,
      rank,
      gamesPlayed,
      wins,
      losses,
      ties,
      winPct,
      pointsFor,
      pointsAgainst,
      streak,
    ],
  );
}

// ---- Per-league ingest ---------------------------------------------------
async function ingestLeague(
  c: Client,
  mapping: LeagueMapping,
): Promise<{ rows: number; missed: number }> {
  const leagueId = await getLeagueId(c, mapping.leagueName);
  if (!leagueId) {
    console.log(`  · ${mapping.leagueName}: league not in DB`);
    return { rows: 0, missed: 0 };
  }

  const url = `https://site.api.espn.com/apis/v2/sports/${mapping.espnSport}/${mapping.espnLeague}/standings`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${mapping.leagueName}`);
  }
  const body = (await res.json()) as EspnResponse;
  const entries = collectEntries(body);

  let rows = 0;
  let missed = 0;
  let rank = 0;
  for (const entry of entries) {
    rank += 1;
    try {
      const teamId = await findOrCreateTeamId(c, leagueId, entry);
      await upsertStanding(c, leagueId, teamId, mapping.season, entry, rank);
      rows += 1;
    } catch (err) {
      missed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ✗ ${entry.team.displayName}: ${msg}`);
    }
  }
  return { rows, missed };
}

// ---- Main ----------------------------------------------------------------
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const args = process.argv.slice(2);
  function flagValue(name: string): string | undefined {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('--')) return undefined;
    return v;
  }
  const leagueArg = flagValue('--league');

  const targets = leagueArg && leagueArg !== 'all'
    ? LEAGUE_MAP.filter((m) => m.leagueName.toLowerCase() === leagueArg.toLowerCase())
    : LEAGUE_MAP;

  if (targets.length === 0) {
    console.error(`No league matched --league=${leagueArg}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  console.log(`→ ingesting standings for ${targets.length} league(s)`);
  let totalRows = 0;
  let totalMissed = 0;
  try {
    for (const m of targets) {
      process.stdout.write(`· ${m.leagueName} … `);
      try {
        const { rows, missed } = await ingestLeague(client, m);
        totalRows += rows;
        totalMissed += missed;
        console.log(`${rows} rows${missed > 0 ? ` (${missed} teams not in DB)` : ''}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${msg}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`\n✓ done. ${totalRows} standings rows, ${totalMissed} teams unmatched.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-standings-espn] fatal: ${msg}`);
  process.exit(1);
});
