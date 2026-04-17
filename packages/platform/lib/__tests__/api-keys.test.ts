import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import {
  createApiKey,
  hashKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  validateApiKey,
} from '../api-keys.js';
import { __setDbForTests } from '../db.js';

/**
 * Minimal DDL for the api_keys lifecycle tests. Mirrors migration 003's
 * additions on top of the P-01 `api_keys` schema — pg-mem doesn't support
 * Timescale extensions so we don't apply the real migration here.
 */
const DDL = `
CREATE TABLE users (
  id    UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE api_keys (
  id           UUID PRIMARY KEY,
  key_hash     VARCHAR(64) NOT NULL UNIQUE,
  plan         VARCHAR(20) NOT NULL DEFAULT 'free',
  owner_email  VARCHAR(320),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  user_id      UUID,
  name         VARCHAR(100),
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read'],
  metadata     JSONB NOT NULL DEFAULT '{}',
  key_prefix   CHAR(16),
  environment  VARCHAR(10) NOT NULL DEFAULT 'live'
);
`;

function makeDb(): Pool {
  const db = newDb();
  // pg-mem needs gen_random_uuid() for some queries — shim it to crypto.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
  });
  const { Pool: PgMemPool } = db.adapters.createPg() as { Pool: new () => Pool };
  return new PgMemPool();
}

describe('api-keys lifecycle', () => {
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    pool = makeDb();
    await pool.query(DDL);
    __setDbForTests(pool);
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, 'u@test.io')`, [userId]);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('createApiKey generates bbs_live_<32 hex> format', async () => {
    const result = await createApiKey(
      { userId, name: 'test', plan: 'free' },
      pool,
    );
    expect(result.key).toMatch(/^bbs_live_[a-f0-9]{32}$/);
    expect(result.prefix).toBe(result.key.slice(0, 16));
    expect(result.keyId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('validateApiKey returns the record for a valid key', async () => {
    const { key } = await createApiKey(
      { userId, name: 'k1', plan: 'starter', scopes: ['read:matches'] },
      pool,
    );
    const record = await validateApiKey(key, pool);
    expect(record).not.toBeNull();
    expect(record!.plan).toBe('starter');
    expect(record!.scopes).toContain('read:matches');
    expect(record!.environment).toBe('live');
  });

  it('validateApiKey returns null for malformed or unknown keys', async () => {
    expect(await validateApiKey('not-a-key', pool)).toBeNull();
    expect(await validateApiKey('bbs_live_00000000000000000000000000000000', pool)).toBeNull();
  });

  it('validateApiKey returns null for revoked keys', async () => {
    const { key, keyId } = await createApiKey(
      { userId, name: 'k-r', plan: 'free' },
      pool,
    );
    await revokeApiKey(keyId, userId, pool);
    expect(await validateApiKey(key, pool)).toBeNull();
  });

  it('listApiKeys never returns key_hash or raw key', async () => {
    await createApiKey({ userId, name: 'k1', plan: 'free' }, pool);
    await createApiKey({ userId, name: 'k2', plan: 'free', environment: 'test' }, pool);
    const list = await listApiKeys(userId, pool);
    expect(list).toHaveLength(2);
    for (const k of list) {
      expect(Object.keys(k)).not.toContain('keyHash');
      // The prefix IS exposed; the raw secret never is.
      expect(k.keyPrefix.startsWith('bbs_')).toBe(true);
    }
  });

  it('rotateApiKey invalidates the old key and issues a new one atomically', async () => {
    const original = await createApiKey(
      { userId, name: 'rotate-me', plan: 'pro', scopes: ['read:odds', 'stream:live'] },
      pool,
    );
    const rotated = await rotateApiKey(original.keyId, userId, pool);

    // Old key: should no longer validate
    expect(await validateApiKey(original.key, pool)).toBeNull();
    // New key: validates with same scopes/plan
    const newRecord = await validateApiKey(rotated.key, pool);
    expect(newRecord).not.toBeNull();
    expect(newRecord!.plan).toBe('pro');
    expect(newRecord!.scopes).toEqual(expect.arrayContaining(['read:odds', 'stream:live']));
    // Both IDs exist (old is revoked, new is active)
    const list = await listApiKeys(userId, pool);
    const original_ = list.find((k) => k.id === original.keyId);
    const rotated_  = list.find((k) => k.id === rotated.keyId);
    expect(original_?.revokedAt).not.toBeNull();
    expect(rotated_?.revokedAt).toBeNull();
  });

  it('hashKey is SHA-256 hex', () => {
    const h = hashKey('bbs_live_0000');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revoked keys appear in listApiKeys with revokedAt set', async () => {
    const { keyId } = await createApiKey({ userId, name: 'soon-gone', plan: 'free' }, pool);
    await revokeApiKey(keyId, userId, pool);
    const list = await listApiKeys(userId, pool);
    expect(list).toHaveLength(1);
    expect(list[0]?.revokedAt).not.toBeNull();
  });
});
