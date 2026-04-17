/**
 * Seeds the `sports` and `leagues` tables with the canonical catalogue.
 * Idempotent — safe to run repeatedly.
 *
 *   pnpm --filter @bbs/shared exec tsx scripts/seed-sports.ts
 */

import { Client } from 'pg';
import type { SportType } from '../src/types.js';

interface SportSeed {
  readonly slug: SportType;
  readonly name: string;
}

interface LeagueSeed {
  readonly sportSlug: SportType;
  readonly name: string;
  readonly country: string;
  readonly season: string;
}

const SPORTS: readonly SportSeed[] = [
  { slug: 'football', name: 'Football (Soccer)' },
  { slug: 'basketball', name: 'Basketball' },
  { slug: 'baseball', name: 'Baseball' },
  { slug: 'ice_hockey', name: 'Ice Hockey' },
  { slug: 'cricket', name: 'Cricket' },
  { slug: 'mma', name: 'Mixed Martial Arts' },
  { slug: 'boxing', name: 'Boxing' },
  { slug: 'esports', name: 'Esports' },
  { slug: 'formula1', name: 'Formula 1' },
  { slug: 'american_football', name: 'American Football' },
  { slug: 'rugby', name: 'Rugby' },
] as const;

const LEAGUES: readonly LeagueSeed[] = [
  // Football (soccer)
  { sportSlug: 'football', name: 'EPL', country: 'England', season: '2025-26' },
  { sportSlug: 'football', name: 'La Liga', country: 'Spain', season: '2025-26' },
  { sportSlug: 'football', name: 'Bundesliga', country: 'Germany', season: '2025-26' },
  { sportSlug: 'football', name: 'Serie A', country: 'Italy', season: '2025-26' },
  { sportSlug: 'football', name: 'Ligue 1', country: 'France', season: '2025-26' },
  { sportSlug: 'football', name: 'MLS', country: 'USA', season: '2026' },

  // American football / basketball / baseball / ice hockey
  { sportSlug: 'american_football', name: 'NFL', country: 'USA', season: '2025' },
  { sportSlug: 'american_football', name: 'NCAAF', country: 'USA', season: '2025' },
  { sportSlug: 'basketball', name: 'NBA', country: 'USA', season: '2025-26' },
  { sportSlug: 'baseball', name: 'MLB', country: 'USA', season: '2026' },
  { sportSlug: 'ice_hockey', name: 'NHL', country: 'USA', season: '2025-26' },

  // Cricket
  { sportSlug: 'cricket', name: 'Test Cricket', country: 'International', season: '2026' },
  { sportSlug: 'cricket', name: 'ODI Cricket', country: 'International', season: '2026' },
  { sportSlug: 'cricket', name: 'T20I Cricket', country: 'International', season: '2026' },
  { sportSlug: 'cricket', name: 'IPL', country: 'India', season: '2026' },

  // Combat
  { sportSlug: 'mma', name: 'UFC', country: 'USA', season: '2026' },
  { sportSlug: 'mma', name: 'Bellator', country: 'USA', season: '2026' },
  { sportSlug: 'boxing', name: 'WBC Boxing', country: 'International', season: '2026' },
] as const;

function resolveConnectionString(): string {
  const url = process.env['DATABASE_URL'];
  if (!url || url.length === 0) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

async function seed(): Promise<void> {
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  try {
    await client.query('BEGIN');

    for (const sport of SPORTS) {
      await client.query(
        `INSERT INTO sports (name, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING`,
        [sport.name, sport.slug],
      );
    }

    for (const league of LEAGUES) {
      const sportResult = await client.query<{ bbs_id: string }>(
        `SELECT bbs_id FROM sports WHERE slug = $1`,
        [league.sportSlug],
      );
      const sportRow = sportResult.rows[0];
      if (!sportRow) {
        throw new Error(`Sport not found for slug: ${league.sportSlug}`);
      }

      await client.query(
        `INSERT INTO leagues (sport_id, name, country, season, external_ids)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)
         ON CONFLICT (sport_id, name, season) DO NOTHING`,
        [sportRow.bbs_id, league.name, league.country, league.season],
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${SPORTS.length} sports and ${LEAGUES.length} leagues.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* ignored — rollback failure is not actionable here */
    });
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[seed-sports] failed: ${msg}`);
  process.exit(1);
});
