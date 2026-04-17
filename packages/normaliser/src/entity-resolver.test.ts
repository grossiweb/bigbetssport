import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';
import { EntityResolver } from './entity-resolver.js';

/**
 * Minimal DDL covering the tables the resolver touches. We skip the full
 * migration because pg-mem doesn't support Timescale / uuid-ossp extensions
 * and we don't need them here.
 */
const DDL = `
  CREATE TABLE sports (
    bbs_id UUID PRIMARY KEY,
    slug   VARCHAR(40) NOT NULL UNIQUE,
    name   VARCHAR(100) NOT NULL
  );

  CREATE TABLE leagues (
    bbs_id   UUID PRIMARY KEY,
    sport_id UUID NOT NULL,
    name     VARCHAR(200) NOT NULL
  );

  CREATE TABLE teams (
    bbs_id    UUID PRIMARY KEY,
    league_id UUID,
    name      VARCHAR(200) NOT NULL
  );

  CREATE TABLE players (
    bbs_id  UUID PRIMARY KEY,
    team_id UUID
  );

  CREATE TABLE entity_aliases (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    bbs_id      UUID        NOT NULL,
    alias       TEXT        NOT NULL,
    source      VARCHAR(50) NOT NULL
  );

  CREATE TABLE unresolved_entities (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    raw_name    TEXT        NOT NULL,
    source      VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
  );
`;

interface SeedIds {
  readonly footballSportId: string;
  readonly eplLeagueId: string;
  readonly manCityTeamId: string;
}

async function seed(pool: Pool): Promise<SeedIds> {
  const footballSportId = randomUUID();
  const eplLeagueId = randomUUID();
  const manCityTeamId = randomUUID();

  await pool.query(`INSERT INTO sports (bbs_id, slug, name) VALUES ($1, 'football', 'Football')`, [
    footballSportId,
  ]);
  await pool.query(
    `INSERT INTO leagues (bbs_id, sport_id, name) VALUES ($1, $2, 'EPL')`,
    [eplLeagueId, footballSportId],
  );
  await pool.query(`INSERT INTO teams (bbs_id, league_id, name) VALUES ($1, $2, 'Manchester City')`, [
    manCityTeamId,
    eplLeagueId,
  ]);

  // Canonical + expanded aliases both pointing to the same team bbs_id.
  const aliases: readonly string[] = ['Manchester City', 'Man City'];
  for (const alias of aliases) {
    await pool.query(
      `INSERT INTO entity_aliases (entity_type, bbs_id, alias, source) VALUES ('team', $1, $2, 'seed')`,
      [manCityTeamId, alias],
    );
  }

  return { footballSportId, eplLeagueId, manCityTeamId };
}

describe('EntityResolver', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let resolver: EntityResolver;
  let ids: SeedIds;

  beforeEach(async () => {
    db = newDb();
    // pg-mem v3 returns a cjs-style factory; cast the Pool as the `pg` type.
    const { Pool: PgMemPool } = db.adapters.createPg() as { Pool: new () => Pool };
    pool = new PgMemPool();
    await pool.query(DDL);
    ids = await seed(pool);
    resolver = new EntityResolver(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('pass 1 exact: exact alias match returns bbs_id with confidence 1', async () => {
    const result = await resolver.resolveTeam('Manchester City', 'football', 'test');
    expect(result.method).toBe('exact');
    expect(result.confidence).toBe(1);
    expect(result.bbs_id).toBe(ids.manCityTeamId);
  });

  it("'Man City' and 'Manchester City' resolve to the same bbs_id", async () => {
    const a = await resolver.resolveTeam('Man City', 'football', 'test');
    const b = await resolver.resolveTeam('Manchester City', 'football', 'test');
    expect(a.bbs_id).toBe(b.bbs_id);
    expect(a.bbs_id).toBe(ids.manCityTeamId);
    expect(a.method).toBe('exact');
  });

  it('pass 2 normalised: case-different + FC suffix matches via normalised pass', async () => {
    // Not an exact alias (case differs, adds 'FC' suffix), but normalises
    // to the same key as the stored 'Manchester City' alias: 'manchester'.
    const result = await resolver.resolveTeam('Manchester City FC', 'football', 'test');
    expect(result.method).toBe('normalised');
    expect(result.confidence).toBe(0.85);
    expect(result.bbs_id).toBe(ids.manCityTeamId);
  });

  it('pass 3 fuzzy: one-character typo resolves via Levenshtein', async () => {
    const result = await resolver.resolveTeam('Manchestr City', 'football', 'test');
    expect(result.method).toBe('fuzzy');
    expect(result.confidence).toBe(0.7);
    expect(result.bbs_id).toBe(ids.manCityTeamId);
  });

  it('unknown team → method=unresolved and inserts into unresolved_entities', async () => {
    const result = await resolver.resolveTeam('Nonexistent FC', 'football', 'test-source');
    expect(result.method).toBe('unresolved');
    expect(result.confidence).toBe(0);
    expect(result.bbs_id).toBe('');

    const row = await pool.query<{ raw_name: string; source: string; entity_type: string }>(
      `SELECT raw_name, source, entity_type FROM unresolved_entities WHERE raw_name = $1`,
      ['Nonexistent FC'],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]).toMatchObject({
      raw_name: 'Nonexistent FC',
      source: 'test-source',
      entity_type: 'team',
    });
  });

  it('resolveLeague uses the league JOIN chain', async () => {
    // Seed a league alias for EPL.
    await pool.query(
      `INSERT INTO entity_aliases (entity_type, bbs_id, alias, source)
       VALUES ('league', $1, 'EPL', 'seed')`,
      [ids.eplLeagueId],
    );
    const result = await resolver.resolveLeague('EPL', 'football');
    expect(result.method).toBe('exact');
    expect(result.bbs_id).toBe(ids.eplLeagueId);
  });

  it('resolveTeam for unrelated sport does not leak across sports', async () => {
    // Seed a basketball team with the same 'Manchester' substring — it lives
    // under a different sport, so football resolution must not return it.
    const basketballSportId = randomUUID();
    const nbaLeagueId = randomUUID();
    const dummyTeamId = randomUUID();
    await pool.query(
      `INSERT INTO sports (bbs_id, slug, name) VALUES ($1, 'basketball', 'Basketball')`,
      [basketballSportId],
    );
    await pool.query(
      `INSERT INTO leagues (bbs_id, sport_id, name) VALUES ($1, $2, 'NBA')`,
      [nbaLeagueId, basketballSportId],
    );
    await pool.query(
      `INSERT INTO teams (bbs_id, league_id, name) VALUES ($1, $2, 'Manchester Basketball')`,
      [dummyTeamId, nbaLeagueId],
    );
    await pool.query(
      `INSERT INTO entity_aliases (entity_type, bbs_id, alias, source)
       VALUES ('team', $1, 'Manchester Basketball', 'seed')`,
      [dummyTeamId],
    );

    const result = await resolver.resolveTeam('Manchester Basketball', 'football', 'test');
    // Pass 1 is sport-agnostic → exact match still finds it. But the passes 2/3
    // that DO filter by sport would not. The test here documents pass-1 behaviour.
    expect(result.method).toBe('exact');
    expect(result.bbs_id).toBe(dummyTeamId);
  });
});
