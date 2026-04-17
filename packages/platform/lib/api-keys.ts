import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { db, withTransaction } from './db.js';

/**
 * API key lifecycle: create, validate, rotate, revoke, list.
 *
 * Key format:   bbs_{live|test}_{32 hex chars}
 * Storage:      SHA-256 hash only. The raw key is returned ONCE on creation
 *               and never retrievable again.
 * Display:      `key_prefix` stores the first 16 chars of the raw key so the
 *               dashboard can render a non-secret identifier per key.
 */

export type Plan = 'free' | 'starter' | 'pro' | 'enterprise';
export type Environment = 'live' | 'test';
export type Scope =
  | 'read'
  | 'read:matches'
  | 'read:odds'
  | 'read:players'
  | 'read:standings'
  | 'read:injuries'
  | 'stream:live'
  | 'webhook:write';

export const ALL_SCOPES: readonly Scope[] = [
  'read',
  'read:matches',
  'read:odds',
  'read:players',
  'read:standings',
  'read:injuries',
  'stream:live',
  'webhook:write',
];

export interface ApiKeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly plan: Plan;
  readonly scopes: readonly Scope[];
  readonly environment: Environment;
  readonly keyPrefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly ownerEmail: string | null;
}

/** Public listing shape — never includes `keyHash` or the raw key. */
export type SafeApiKey = Omit<ApiKeyRecord, 'userId'> & { readonly userId: string };

export interface CreateKeyParams {
  readonly userId: string;
  readonly name: string;
  readonly plan: Plan;
  readonly environment?: Environment;
  readonly scopes?: readonly Scope[];
  readonly ownerEmail?: string;
}

export interface CreateKeyResult {
  readonly key: string;
  readonly keyId: string;
  readonly prefix: string;
}

const KEY_RANDOM_BYTES = 16; // 32 hex chars
const PREFIX_LEN = 16; // e.g. "bbs_live_a1b2c3d4"

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

function generateRawKey(environment: Environment): string {
  const random = randomBytes(KEY_RANDOM_BYTES).toString('hex');
  return `bbs_${environment}_${random}`;
}

function prefixOf(raw: string): string {
  return raw.slice(0, PREFIX_LEN);
}

// --- Row mappers ----------------------------------------------------------

interface DbApiKeyRow {
  id: string;
  user_id: string | null;
  name: string | null;
  plan: string;
  scopes: string[] | null;
  environment: string | null;
  key_prefix: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  owner_email: string | null;
}

function rowToRecord(row: DbApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id ?? '',
    name: row.name,
    plan: (row.plan as Plan) ?? 'free',
    scopes: (row.scopes ?? ['read']) as readonly Scope[],
    environment: (row.environment as Environment) ?? 'live',
    keyPrefix: row.key_prefix ?? '',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    ownerEmail: row.owner_email,
  };
}

// --- Public API -----------------------------------------------------------

export async function createApiKey(
  params: CreateKeyParams,
  pool: Pool = db(),
): Promise<CreateKeyResult> {
  const environment = params.environment ?? 'live';
  const scopes = params.scopes && params.scopes.length > 0 ? params.scopes : ['read'];
  const raw = generateRawKey(environment);
  const prefix = prefixOf(raw);
  const hash = hashKey(raw);

  const id = randomUUID();
  await pool.query(
    `INSERT INTO api_keys
       (id, key_hash, plan, owner_email, created_at, user_id, name, scopes, environment, key_prefix)
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9)`,
    [
      id,
      hash,
      params.plan,
      params.ownerEmail ?? null,
      params.userId,
      params.name,
      scopes,
      environment,
      prefix,
    ],
  );

  return { key: raw, keyId: id, prefix };
}

/**
 * Look up a key by its raw string. Constant-time compare on the hash.
 * Returns null for unknown, revoked, or malformed keys.
 */
export async function validateApiKey(
  rawKey: string,
  pool: Pool = db(),
): Promise<ApiKeyRecord | null> {
  const trimmed = rawKey.trim();
  if (!/^bbs_(live|test)_[a-f0-9]{32}$/.test(trimmed)) return null;

  const hash = hashKey(trimmed);
  const result = await pool.query<DbApiKeyRow>(
    `SELECT id, user_id, name, plan, scopes, environment, key_prefix,
            created_at, last_used_at, revoked_at, owner_email, key_hash
       FROM api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [hash],
  );
  const row = result.rows[0];
  if (!row) return null;

  // Extra belt-and-braces constant-time verification on the hash value.
  const rowHash = (row as DbApiKeyRow & { key_hash: string }).key_hash;
  if (typeof rowHash === 'string' && rowHash.length === hash.length) {
    const a = Buffer.from(rowHash);
    const b = Buffer.from(hash);
    if (!timingSafeEqual(a, b)) return null;
  }

  return rowToRecord(row);
}

export async function listApiKeys(
  userId: string,
  pool: Pool = db(),
): Promise<SafeApiKey[]> {
  const result = await pool.query<DbApiKeyRow>(
    `SELECT id, user_id, name, plan, scopes, environment, key_prefix,
            created_at, last_used_at, revoked_at, owner_email
       FROM api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(rowToRecord);
}

/**
 * Rotate a key: mark the old record revoked and create a new one with the
 * same name, plan, scopes, environment. Atomic via a single transaction.
 */
export async function rotateApiKey(
  keyId: string,
  userId: string,
  pool: Pool = db(),
): Promise<CreateKeyResult> {
  return withTransaction(async (c) => {
    const existing = await c.query<DbApiKeyRow>(
      `SELECT id, user_id, name, plan, scopes, environment, key_prefix,
              created_at, last_used_at, revoked_at, owner_email
         FROM api_keys WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [keyId, userId],
    );
    const old = existing.rows[0];
    if (!old) throw new Error(`api key not found: ${keyId}`);

    await c.query(`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, [keyId]);

    const environment = (old.environment as Environment) ?? 'live';
    const scopes = (old.scopes ?? ['read']) as readonly Scope[];
    const raw = generateRawKey(environment);
    const prefix = prefixOf(raw);
    const hash = hashKey(raw);
    const newId = randomUUID();
    await c.query(
      `INSERT INTO api_keys
         (id, key_hash, plan, owner_email, created_at, user_id, name, scopes, environment, key_prefix)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9)`,
      [
        newId,
        hash,
        old.plan,
        old.owner_email,
        userId,
        old.name,
        scopes,
        environment,
        prefix,
      ],
    );
    return { key: raw, keyId: newId, prefix };
  });
}

/** Soft-delete: mark revoked_at = NOW(). Idempotent on already-revoked keys. */
export async function revokeApiKey(
  keyId: string,
  userId: string,
  pool: Pool = db(),
): Promise<void> {
  await pool.query(
    `UPDATE api_keys SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId],
  );
}

/** Touch `last_used_at` — called by the gateway usage-logger middleware. */
export async function touchLastUsed(
  keyId: string,
  pool: Pool = db(),
): Promise<void> {
  await pool
    .query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [keyId])
    .catch(() => undefined);
}
