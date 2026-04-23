/**
 * TheSportsDB enrichment — backfills logo_url, venues, and thesportsdb
 * external_id for every team in our DB that doesn't have one yet.
 *
 * Usage:
 *   tsx packages/orchestrator/scripts/enrich-thesportsdb.ts
 *
 * Env:
 *   DATABASE_URL           (required)
 *   THESPORTSDB_API_KEY    (optional, defaults to "3" = free test key)
 *
 * Rate: the public test key "3" allows ~30 req/min — we add a 300ms
 * delay between calls to stay comfortably under that.
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const API_KEY = process.env['THESPORTSDB_API_KEY'] ?? '3';
const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const DELAY_MS = 1000;

// BBS slug → TheSportsDB strSport
const SPORT_MAP: Record<string, readonly string[]> = {
  basketball: ['Basketball'],
  baseball: ['Baseball'],
  ice_hockey: ['Ice Hockey'],
  football: ['Soccer'],
  american_football: ['American Football'],
  mma: ['Fighting', 'MMA'],
  boxing: ['Fighting', 'Boxing'],
  cricket: ['Cricket'],
  rugby: ['Rugby'],
};

interface TsdbTeam {
  idTeam: string;
  strTeam: string;
  strSport: string;
  strLeague?: string;
  strBadge?: string | null;
  strLogo?: string | null;
  strStadium?: string | null;
  strLocation?: string | null;
  idVenue?: string | null;
}

interface TeamRow {
  bbs_id: string;
  name: string;
  logo_url: string | null;
  external_ids: Record<string, string>;
  sport_type: string | null;
}

async function fetchTeam(name: string): Promise<readonly TsdbTeam[]> {
  const url = `${BASE}/searchteams.php?t=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return [];
  const body = (await res.json()) as { teams?: readonly TsdbTeam[] | null };
  return body.teams ?? [];
}

function pickBestMatch(
  candidates: readonly TsdbTeam[],
  sportSlug: string,
): TsdbTeam | null {
  const allowed = SPORT_MAP[sportSlug] ?? [];
  for (const t of candidates) {
    if (allowed.includes(t.strSport)) return t;
  }
  // Fall back to first candidate if nothing matches the sport filter.
  return candidates[0] ?? null;
}

async function upsertVenue(
  c: Client,
  name: string,
  location: string | null,
): Promise<string | null> {
  if (!name) return null;
  const existing = await c.query<{ bbs_id: string }>(
    `SELECT bbs_id FROM venues WHERE name = $1 LIMIT 1`,
    [name],
  );
  const found = existing.rows[0];
  if (found) return found.bbs_id;

  const city = location?.split(',')[0]?.trim() ?? null;
  const country = location?.split(',').slice(-1)[0]?.trim() ?? null;

  const id = randomUUID();
  await c.query(
    `INSERT INTO venues (bbs_id, name, city, country)
       VALUES ($1, $2, $3, $4)`,
    [id, name, city, country],
  );
  return id;
}

/** Strip doubled words like "Levante Levante" → "Levante". */
function cleanTeamName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  // If exactly 2n words and first half == second half, return first half.
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const a = words.slice(0, half).join(' ').toLowerCase();
    const b = words.slice(half).join(' ').toLowerCase();
    if (a === b) return words.slice(0, half).join(' ');
  }
  return raw;
}

async function processTeam(c: Client, row: TeamRow): Promise<'skipped' | 'updated' | 'nomatch'> {
  // Already enriched? skip.
  if (row.logo_url && row.external_ids?.['thesportsdb']) return 'skipped';

  // Normalise our possibly-doubled team name before querying.
  const cleanName = cleanTeamName(row.name);
  const queryNames = cleanName !== row.name ? [cleanName, row.name] : [row.name];

  let candidates: readonly TsdbTeam[] = [];
  for (const q of queryNames) {
    candidates = await fetchTeam(q);
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return 'nomatch';

  const match = pickBestMatch(candidates, row.sport_type ?? '');
  if (!match) return 'nomatch';

  const logoUrl = match.strBadge ?? match.strLogo ?? null;

  // Optional: create/find venue (side effect; not wired to the team row
  // because the teams schema has no venue_id FK).
  if (match.strStadium) {
    await upsertVenue(c, match.strStadium, match.strLocation ?? null);
  }

  // Also normalise the stored team name if it was doubled.
  const merged = { ...row.external_ids, thesportsdb: match.idTeam };
  await c.query(
    `UPDATE teams
       SET logo_url = COALESCE($1, logo_url),
           name = $2,
           external_ids = $3::jsonb
     WHERE bbs_id = $4`,
    [logoUrl, cleanName, JSON.stringify(merged), row.bbs_id],
  );
  return 'updated';
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Join to matches to get the team's sport_type (used for disambiguation).
    const result = await client.query<TeamRow>(
      `SELECT DISTINCT ON (t.bbs_id)
         t.bbs_id, t.name, t.logo_url, t.external_ids,
         m.sport_type
       FROM teams t
       LEFT JOIN matches m ON (m.home_id = t.bbs_id OR m.away_id = t.bbs_id)
       WHERE t.logo_url IS NULL OR NOT (t.external_ids ? 'thesportsdb')
       ORDER BY t.bbs_id`,
    );

    console.log(`→ enriching ${result.rows.length} team(s)…`);
    let updated = 0;
    let nomatch = 0;
    let skipped = 0;
    for (const row of result.rows) {
      process.stdout.write(`  · ${row.name} (${row.sport_type ?? '?'}) … `);
      try {
        const outcome = await processTeam(client, row);
        if (outcome === 'updated') {
          updated += 1;
          console.log('✓');
        } else if (outcome === 'skipped') {
          skipped += 1;
          console.log('skip');
        } else {
          nomatch += 1;
          console.log('no match');
        }
      } catch (err) {
        nomatch += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${msg}`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    console.log(
      `\n✓ done. ${updated} updated, ${skipped} already had data, ${nomatch} no match.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[enrich-thesportsdb] fatal: ${msg}`);
  process.exit(1);
});
