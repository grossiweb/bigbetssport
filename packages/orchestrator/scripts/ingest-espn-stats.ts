/**
 * ESPN → Postgres team + player match stats ingest.
 *
 * For each match in our DB that ESPN covers (basketball/baseball/
 * american_football/ice_hockey), find the ESPN event_id via the
 * scoreboard endpoint, fetch the boxscore summary, and persist:
 *
 *   - Team stats → match_stats    (source='espn')
 *   - Player stats → player_stats  (source='espn')
 *
 * Dedup strategy: DELETE WHERE (match_id, source='espn') then INSERT.
 * Idempotent on re-run; stats reflect the latest boxscore snapshot.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/ingest-espn-stats.ts [--limit N] [--sport basketball|baseball|...|all]
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const DELAY_MS = 500; // between ESPN summary calls (they're public-permissive)

// BBS sport_type → ESPN {sport, league} URL segments for scoreboard/summary.
interface EspnLeagueMapping {
  readonly sportType: string;     // our matches.sport_type
  readonly leagueName: string;    // our leagues.name (to disambiguate)
  readonly espnSport: string;
  readonly espnLeague: string;
}

const LEAGUE_MAP: readonly EspnLeagueMapping[] = [
  { sportType: 'basketball',        leagueName: 'NBA',        espnSport: 'basketball', espnLeague: 'nba' },
  { sportType: 'baseball',          leagueName: 'MLB',        espnSport: 'baseball',   espnLeague: 'mlb' },
  { sportType: 'ice_hockey',        leagueName: 'NHL',        espnSport: 'hockey',     espnLeague: 'nhl' },
  { sportType: 'american_football', leagueName: 'NFL',        espnSport: 'football',   espnLeague: 'nfl' },
  { sportType: 'american_football', leagueName: 'NCAAF',      espnSport: 'football',   espnLeague: 'college-football' },
  { sportType: 'football',          leagueName: 'EPL',        espnSport: 'soccer',     espnLeague: 'eng.1' },
  { sportType: 'football',          leagueName: 'La Liga',    espnSport: 'soccer',     espnLeague: 'esp.1' },
  { sportType: 'football',          leagueName: 'Bundesliga', espnSport: 'soccer',     espnLeague: 'ger.1' },
  { sportType: 'football',          leagueName: 'Serie A',    espnSport: 'soccer',     espnLeague: 'ita.1' },
  { sportType: 'football',          leagueName: 'Ligue 1',    espnSport: 'soccer',     espnLeague: 'fra.1' },
  { sportType: 'football',          leagueName: 'MLS',        espnSport: 'soccer',     espnLeague: 'usa.1' },
];

interface MatchRow {
  bbs_id: string;
  sport_type: string;
  league_name: string | null;
  kickoff_utc: Date;
  home_id: string | null;
  away_id: string | null;
  home_name: string | null;
  away_name: string | null;
}

// ESPN scoreboard event (subset).
interface EspnScoreboardEvent {
  id: string;
  date: string;
  competitions: ReadonlyArray<{
    competitors: ReadonlyArray<{
      homeAway: 'home' | 'away';
      team: { id: string; displayName: string; abbreviation?: string };
      score?: string;
    }>;
  }>;
}

interface EspnScoreboard {
  events?: readonly EspnScoreboardEvent[];
}

// ESPN summary (subset).
interface EspnStat {
  name: string;
  label?: string;
  displayValue?: string;
}

interface EspnPlayerBlock {
  keys: readonly string[];
  names?: readonly string[];
  labels?: readonly string[];
  athletes: ReadonlyArray<{
    athlete: {
      id: string;
      displayName: string;
      jersey?: string | null;
      position?: { abbreviation?: string } | null;
      headshot?: { href?: string } | null;
    };
    starter?: boolean;
    didNotPlay?: boolean;
    stats: readonly string[];
  }>;
}

interface EspnLineScore {
  displayValue?: string;
  value?: number;
}

interface EspnHeaderCompetitor {
  homeAway: 'home' | 'away';
  team: { id: string; displayName: string };
  linescores?: readonly EspnLineScore[];
}

interface EspnPlay {
  id: string;
  sequenceNumber?: string;
  type?: { text?: string };
  text?: string;
  shortDescription?: string;
  awayScore?: number;
  homeScore?: number;
  period?: { number?: number; displayValue?: string };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  scoreValue?: number;
  team?: { id?: string };
  participants?: ReadonlyArray<{ athlete?: { id?: string } }>;
  wallclock?: string;
  coordinate?: { x?: number; y?: number };
}

interface EspnGameInfo {
  venue?: { fullName?: string };
  attendance?: number;
}

interface EspnSummary {
  header?: {
    competitions?: ReadonlyArray<{
      competitors?: readonly EspnHeaderCompetitor[];
      broadcast?: string | null;
    }>;
  };
  gameInfo?: EspnGameInfo;
  boxscore?: {
    teams?: ReadonlyArray<{
      team: { id: string; displayName: string };
      homeAway?: 'home' | 'away';
      statistics?: readonly EspnStat[];
    }>;
    players?: ReadonlyArray<{
      team: { id: string; displayName: string };
      statistics?: readonly EspnPlayerBlock[];
    }>;
  };
  plays?: readonly EspnPlay[];
}

// ---- Helpers -------------------------------------------------------------

function espnDate(iso: Date): string {
  // YYYYMMDD for ESPN scoreboard ?dates= param
  return iso.toISOString().slice(0, 10).replace(/-/g, '');
}

function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function statFieldName(raw: string): string {
  // Keep it short + DB-safe. The API already uses camelCase; truncate.
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}

// ---- ESPN fetches --------------------------------------------------------

async function fetchScoreboard(
  mapping: EspnLeagueMapping,
  yyyymmdd: string,
): Promise<EspnScoreboard> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.espnSport}/${mapping.espnLeague}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`scoreboard HTTP ${res.status}`);
  return (await res.json()) as EspnScoreboard;
}

async function fetchSummary(
  mapping: EspnLeagueMapping,
  eventId: string,
): Promise<EspnSummary> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.espnSport}/${mapping.espnLeague}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
  return (await res.json()) as EspnSummary;
}

// ---- DB helpers ----------------------------------------------------------

async function findOrCreatePlayerId(
  c: Client,
  teamId: string | null,
  espnId: string,
  displayName: string,
  extra: {
    jersey?: string | null;
    position?: string | null;
    headshotUrl?: string | null;
  },
): Promise<string> {
  // 1) Try ESPN external id
  const byEspn = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM players WHERE external_ids->>'espn' = $1 LIMIT 1`,
    [espnId],
  );
  if (byEspn.rows[0]) return byEspn.rows[0].bbs_id;

  // 2) Match by name + team
  if (teamId) {
    const byName = await c.query<{ bbs_id: string }>(
      `SELECT bbs_id FROM players
         WHERE team_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [teamId, displayName],
    );
    if (byName.rows[0]) {
      // Backfill ESPN id on existing row
      await c.query(
        `UPDATE players
           SET external_ids = external_ids || jsonb_build_object('espn', $1::text)
         WHERE bbs_id = $2`,
        [espnId, byName.rows[0].bbs_id],
      );
      return byName.rows[0].bbs_id;
    }
  }

  // 3) Create new
  const id = randomUUID();
  await c.query(
    `INSERT INTO players
       (bbs_id, team_id, name, position, jersey_number, headshot_url, external_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      id,
      teamId,
      displayName,
      extra.position ?? null,
      extra.jersey ?? null,
      extra.headshotUrl ?? null,
      JSON.stringify({ espn: espnId }),
    ],
  );
  return id;
}

async function insertTeamStats(
  c: Client,
  matchId: string,
  teamId: string,
  stats: readonly EspnStat[],
): Promise<number> {
  let n = 0;
  for (const s of stats) {
    if (!s.name) continue;
    const field = statFieldName(s.name);
    const value = {
      display: s.displayValue ?? null,
      label: s.label ?? null,
    };
    await c.query(
      `INSERT INTO match_stats
         (match_id, team_id, field, value, source, confidence, fetched_at)
       VALUES ($1, $2, $3, $4::jsonb, 'espn', 0.95, NOW())`,
      [matchId, teamId, field, JSON.stringify(value)],
    );
    n += 1;
  }
  return n;
}

async function insertPlayerStats(
  c: Client,
  matchId: string,
  playerId: string,
  keys: readonly string[],
  labels: readonly string[],
  stats: readonly string[],
): Promise<number> {
  let n = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = stats[i];
    if (!key || value === undefined || value === '' || value === '-') continue;
    const field = statFieldName(key);
    const payload = {
      value,
      label: labels[i] ?? null,
    };
    await c.query(
      `INSERT INTO player_stats
         (match_id, player_id, field, value, source, confidence, fetched_at)
       VALUES ($1, $2, $3, $4::jsonb, 'espn', 0.95, NOW())`,
      [matchId, playerId, field, JSON.stringify(payload)],
    );
    n += 1;
  }
  return n;
}

// ---- Per-match processing ------------------------------------------------

async function matchToEspnEvent(
  events: readonly EspnScoreboardEvent[],
  match: MatchRow,
): Promise<EspnScoreboardEvent | null> {
  for (const ev of events) {
    const comp = ev.competitions[0];
    if (!comp) continue;
    const home = comp.competitors.find((c) => c.homeAway === 'home');
    const away = comp.competitors.find((c) => c.homeAway === 'away');
    if (
      sameTeam(home?.team.displayName, match.home_name) &&
      sameTeam(away?.team.displayName, match.away_name)
    ) {
      return ev;
    }
  }
  return null;
}

async function processMatch(
  c: Client,
  match: MatchRow,
  mapping: EspnLeagueMapping,
  scoreboardCache: Map<string, readonly EspnScoreboardEvent[]>,
): Promise<{
  teamStats: number;
  playerStats: number;
  playersCreated: number;
  plays: number;
  linescorePopulated: boolean;
}> {
  const yyyymmdd = espnDate(match.kickoff_utc);
  const cacheKey = `${mapping.espnSport}/${mapping.espnLeague}/${yyyymmdd}`;
  let events = scoreboardCache.get(cacheKey);
  if (!events) {
    const sb = await fetchScoreboard(mapping, yyyymmdd);
    events = sb.events ?? [];
    scoreboardCache.set(cacheKey, events);
  }

  const ev = await matchToEspnEvent(events, match);
  if (!ev) {
    return {
      teamStats: 0,
      playerStats: 0,
      playersCreated: 0,
      plays: 0,
      linescorePopulated: false,
    };
  }

  const summary = await fetchSummary(mapping, ev.id);

  // Backfill the ESPN event id onto our match row
  await c.query(
    `UPDATE matches
       SET external_ids = external_ids || jsonb_build_object('espn', $1::text)
     WHERE bbs_id = $2`,
    [ev.id, match.bbs_id],
  );

  // --- Per-match metadata: linescore, attendance, broadcast ---
  const linescorePopulated = await updateMatchMeta(c, match, summary);

  // Wipe previous ESPN-sourced rows for this match, then re-insert fresh.
  await c.query(`DELETE FROM match_stats   WHERE match_id = $1 AND source = 'espn'`, [match.bbs_id]);
  await c.query(`DELETE FROM player_stats  WHERE match_id = $1 AND source = 'espn'`, [match.bbs_id]);
  await c.query(`DELETE FROM match_events  WHERE match_id = $1 AND source = 'espn'`, [match.bbs_id]);

  // --- Team stats ---
  let teamStats = 0;
  for (const t of summary.boxscore?.teams ?? []) {
    const teamId =
      sameTeam(t.team.displayName, match.home_name) ? match.home_id :
      sameTeam(t.team.displayName, match.away_name) ? match.away_id :
      null;
    if (!teamId || !t.statistics) continue;
    teamStats += await insertTeamStats(c, match.bbs_id, teamId, t.statistics);
  }

  // --- Player stats ---
  let playerStats = 0;
  let playersCreated = 0;
  const playerCountBefore = await c.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM players`);
  for (const teamBlock of summary.boxscore?.players ?? []) {
    const teamId =
      sameTeam(teamBlock.team.displayName, match.home_name) ? match.home_id :
      sameTeam(teamBlock.team.displayName, match.away_name) ? match.away_id :
      null;
    for (const block of teamBlock.statistics ?? []) {
      const keys = block.keys ?? [];
      const labels = block.labels ?? block.names ?? keys;
      for (const row of block.athletes ?? []) {
        if (row.didNotPlay) continue;
        const playerId = await findOrCreatePlayerId(
          c,
          teamId,
          row.athlete.id,
          row.athlete.displayName,
          {
            jersey: row.athlete.jersey ?? null,
            position: row.athlete.position?.abbreviation ?? null,
            headshotUrl: row.athlete.headshot?.href ?? null,
          },
        );
        playerStats += await insertPlayerStats(c, match.bbs_id, playerId, keys, labels, row.stats ?? []);
      }
    }
  }
  const playerCountAfter = await c.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM players`);
  playersCreated = Number(playerCountAfter.rows[0]?.c ?? 0) - Number(playerCountBefore.rows[0]?.c ?? 0);

  // --- Play-by-play events ---
  const playsInserted = await insertPlays(c, match, summary.plays ?? []);

  return {
    teamStats,
    playerStats,
    playersCreated,
    plays: playsInserted,
    linescorePopulated,
  };
}

// ---- Linescore + game metadata -------------------------------------------

async function updateMatchMeta(
  c: Client,
  match: MatchRow,
  summary: EspnSummary,
): Promise<boolean> {
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((x) => x.homeAway === 'home');
  const away = competitors.find((x) => x.homeAway === 'away');

  const homeScores = (home?.linescores ?? [])
    .map((l) => (l.value ?? (l.displayValue ? Number(l.displayValue) : null)))
    .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));
  const awayScores = (away?.linescores ?? [])
    .map((l) => (l.value ?? (l.displayValue ? Number(l.displayValue) : null)))
    .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));

  const linescoreValid = homeScores.length > 0 && awayScores.length > 0;
  const linescore = linescoreValid
    ? JSON.stringify({ home: homeScores, away: awayScores })
    : null;

  const attendance = summary.gameInfo?.attendance ?? null;
  const broadcast = summary.header?.competitions?.[0]?.broadcast ?? null;

  await c.query(
    `UPDATE matches
       SET linescore  = COALESCE($1::jsonb, linescore),
           attendance = COALESCE($2, attendance),
           broadcast  = COALESCE($3, broadcast)
     WHERE bbs_id = $4`,
    [linescore, attendance, broadcast, match.bbs_id],
  );
  return linescoreValid;
}

// ---- Play-by-play --------------------------------------------------------

/** ESPN emits -2147483640 when coords are N/A. Filter those out. */
function validCoord(n: number | undefined): number | null {
  if (typeof n !== 'number') return null;
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > 10_000) return null;
  return n;
}

async function insertPlays(
  c: Client,
  match: MatchRow,
  plays: readonly EspnPlay[],
): Promise<number> {
  if (plays.length === 0) return 0;

  // Cache our team ids keyed by ESPN team id (if we have them).
  const teamsResult = await c.query<{ bbs_id: string; espn_id: string }>(
    `SELECT bbs_id, external_ids->>'espn' AS espn_id
       FROM teams
       WHERE bbs_id IN ($1::uuid, $2::uuid) AND external_ids ? 'espn'`,
    [match.home_id, match.away_id],
  );
  const teamByEspnId = new Map<string, string>();
  for (const r of teamsResult.rows) {
    if (r.espn_id) teamByEspnId.set(r.espn_id, r.bbs_id);
  }

  // Cache player ids keyed by ESPN athlete id.
  const playerIdCache = new Map<string, string>();
  async function resolvePlayer(espnAthleteId: string): Promise<string | null> {
    if (playerIdCache.has(espnAthleteId)) {
      return playerIdCache.get(espnAthleteId) ?? null;
    }
    const r = await c.query<{ bbs_id: string }>(
      `SELECT bbs_id FROM players WHERE external_ids->>'espn' = $1 LIMIT 1`,
      [espnAthleteId],
    );
    const id = r.rows[0]?.bbs_id ?? null;
    if (id) playerIdCache.set(espnAthleteId, id);
    return id;
  }

  let n = 0;
  for (const p of plays) {
    const teamId = p.team?.id ? teamByEspnId.get(p.team.id) ?? null : null;
    const firstAthleteEspn = p.participants?.[0]?.athlete?.id;
    const playerId = firstAthleteEspn ? await resolvePlayer(firstAthleteEspn) : null;

    const seq = p.sequenceNumber ? Number.parseInt(p.sequenceNumber, 10) : null;
    const x = validCoord(p.coordinate?.x);
    const y = validCoord(p.coordinate?.y);
    const wallclock = p.wallclock ? new Date(p.wallclock) : null;

    try {
      await c.query(
        `INSERT INTO match_events
           (match_id, source, external_id, sequence_number, period, period_display,
            clock, type, description, team_id, player_id, scoring_play, score_value,
            home_score, away_score, coordinate_x, coordinate_y, wallclock)
         VALUES ($1, 'espn', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (match_id, source, external_id) DO NOTHING`,
        [
          match.bbs_id,
          p.id,
          seq,
          p.period?.number ?? null,
          p.period?.displayValue ?? null,
          p.clock?.displayValue ?? null,
          p.type?.text ?? null,
          p.text ?? p.shortDescription ?? null,
          teamId,
          playerId,
          p.scoringPlay ?? false,
          p.scoreValue ?? null,
          p.homeScore ?? null,
          p.awayScore ?? null,
          x,
          y,
          wallclock,
        ],
      );
      n += 1;
    } catch (err) {
      // Most likely a FK violation; skip this play.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ✗ play ${p.id}: ${msg}`);
    }
  }
  return n;
}

// ---- Main ----------------------------------------------------------------

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
  const sportFilter = flag('--sport');
  const limitArg = flag('--limit');
  const limit = limitArg ? Number.parseInt(limitArg, 10) : 0;

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Fetch matches joined with teams + league for matching.
    const where: string[] = [];
    const params: unknown[] = [];
    if (sportFilter && sportFilter !== 'all') {
      params.push(sportFilter);
      where.push(`m.sport_type = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const matches = await client.query<MatchRow>(
      `SELECT
         m.bbs_id, m.sport_type, l.name AS league_name,
         m.kickoff_utc, m.home_id, m.away_id,
         h.name AS home_name, a.name AS away_name
       FROM matches m
       LEFT JOIN leagues l ON l.bbs_id = m.league_id
       LEFT JOIN teams   h ON h.bbs_id = m.home_id
       LEFT JOIN teams   a ON a.bbs_id = m.away_id
       ${whereSql}
       ORDER BY
         CASE WHEN m.status = 'finished' THEN 0
              WHEN m.status = 'live'     THEN 1
              ELSE 2 END,
         m.kickoff_utc DESC
       ${limit > 0 ? `LIMIT ${limit}` : ''}`,
      params,
    );

    console.log(`→ processing ${matches.rows.length} match(es)`);
    const scoreboardCache = new Map<string, readonly EspnScoreboardEvent[]>();
    let ok = 0;
    let nomatch = 0;
    let totalTeamStats = 0;
    let totalPlayerStats = 0;
    let totalPlayersCreated = 0;
    let totalPlays = 0;
    let matchesWithLinescore = 0;

    for (const match of matches.rows) {
      // Find the correct ESPN league mapping
      const mapping = LEAGUE_MAP.find(
        (m) =>
          m.sportType === match.sport_type &&
          (m.leagueName === match.league_name || !match.league_name),
      );
      if (!mapping) {
        continue; // unsupported sport/league
      }

      const label = `${match.away_name} @ ${match.home_name} (${match.league_name})`;
      process.stdout.write(`  · ${label} … `);
      try {
        const result = await processMatch(client, match, mapping, scoreboardCache);
        if (
          result.teamStats === 0 &&
          result.playerStats === 0 &&
          result.plays === 0 &&
          !result.linescorePopulated
        ) {
          nomatch += 1;
          console.log('no ESPN event found');
        } else {
          ok += 1;
          totalTeamStats += result.teamStats;
          totalPlayerStats += result.playerStats;
          totalPlayersCreated += result.playersCreated;
          totalPlays += result.plays;
          if (result.linescorePopulated) matchesWithLinescore += 1;
          const parts: string[] = [];
          if (result.linescorePopulated) parts.push('linescore');
          if (result.teamStats > 0) parts.push(`${result.teamStats} team`);
          if (result.playerStats > 0) parts.push(`${result.playerStats} player`);
          if (result.plays > 0) parts.push(`${result.plays} plays`);
          console.log(
            (parts.join(' / ') || 'event found') +
              (result.playersCreated > 0 ? ` (+${result.playersCreated} new players)` : ''),
          );
        }
      } catch (err) {
        nomatch += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${msg}`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log(
      `\n✓ done. ${ok} matches processed, ${nomatch} skipped.` +
        `\n  Linescore populated: ${matchesWithLinescore} match(es)` +
        `\n  Team stats: ${totalTeamStats} rows` +
        `\n  Player stats: ${totalPlayerStats} rows` +
        `\n  Match events (plays): ${totalPlays} rows` +
        `\n  New players auto-created: ${totalPlayersCreated}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest-espn-stats] fatal: ${msg}`);
  process.exit(1);
});
