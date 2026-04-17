/**
 * Portable migration runner. Applies every `.sql` file in
 * `infra/postgres/migrations/` to the database pointed at by
 * PLATFORM_DATABASE_URL (or DATABASE_URL), in lexicographic order.
 *
 * Usage:
 *   pnpm --filter @bbs/platform migrate
 *   # or directly:
 *   tsx packages/platform/scripts/migrate.ts
 *
 * Tracks applied migrations in `platform_migrations` so re-runs are safe.
 *
 * Works without Docker — just needs a reachable Postgres + the connection
 * string in env. Use Neon (https://neon.tech) for a zero-install dev DB.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', 'infra', 'postgres', 'migrations');

async function main(): Promise<void> {
  const url = process.env['PLATFORM_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    console.error('✗ PLATFORM_DATABASE_URL (or DATABASE_URL) is not set.');
    console.error('  Set it in .env or export it before running this script.');
    process.exit(1);
  }

  console.log('→ Connecting to Postgres…');
  const client = new Client({ connectionString: url });
  await client.connect();

  // Tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set<string>();
  const appliedRows = await client.query<{ name: string }>(
    `SELECT name FROM platform_migrations`,
  );
  for (const r of appliedRows.rows) applied.add(r.name);

  // Discover files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.warn('  No migrations found in', MIGRATIONS_DIR);
    await client.end();
    return;
  }

  let appliedThisRun = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· skip ${file} (already applied)`);
      continue;
    }
    const path = join(MIGRATIONS_DIR, file);
    const sql = await readFile(path, 'utf-8');
    console.log(`→ applying ${file}…`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO platform_migrations (name) VALUES ($1)`,
        [file],
      );
      await client.query('COMMIT');
      appliedThisRun += 1;
      console.log(`✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${file} failed: ${msg}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nDone. Applied ${appliedThisRun} migration${appliedThisRun === 1 ? '' : 's'}; ${applied.size + appliedThisRun} total.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ migrate failed: ${msg}`);
  process.exit(1);
});
