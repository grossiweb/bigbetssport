import { Pool, type PoolClient } from 'pg';

/**
 * Process-wide Postgres pool. Platform server actions and API routes share
 * one connection pool; Next.js module-caches this at the runtime level.
 */

let poolInstance: Pool | null = null;

function resolveUrl(): string {
  const url = process.env['PLATFORM_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'PLATFORM_DATABASE_URL (or DATABASE_URL) is not set. Platform server actions need a Postgres connection.',
    );
  }
  return url;
}

export function db(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: resolveUrl(),
      max: Number(process.env['PLATFORM_DB_POOL_MAX'] ?? 10),
      idleTimeoutMillis: 30_000,
    });
    poolInstance.on('error', (err) => {
      console.error(`[platform:db] pool error: ${err.message}`);
    });
  }
  return poolInstance;
}

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Test-only — replace the singleton pool with a pre-built one. */
export function __setDbForTests(pool: Pool): void {
  poolInstance = pool;
}
