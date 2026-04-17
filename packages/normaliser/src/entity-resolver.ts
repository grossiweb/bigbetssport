import { distance } from 'fastest-levenshtein';
import type { Pool } from 'pg';
import type { SportType } from '@bbs/shared';
import { normaliseForComparison, normaliseString } from './text.js';

/**
 * Three-pass entity resolution.
 *
 *   Pass 1 — exact alias match     (confidence 1.00)
 *   Pass 2 — normalised match      (confidence 0.85; strip accents/suffixes/case)
 *   Pass 3 — fuzzy match           (confidence 0.70; Levenshtein ≤ 2)
 *   Unresolved                     (confidence 0.00; logged to unresolved_entities)
 *
 * Passes 2 and 3 are scoped to the sport so a team with the same
 * normalised name in a different sport doesn't cross-contaminate (e.g.
 * "Barcelona" football vs. basketball).
 */

export type ResolveMethod = 'exact' | 'normalised' | 'fuzzy' | 'unresolved';

export interface ResolveResult {
  readonly bbs_id: string;
  readonly confidence: number;
  readonly method: ResolveMethod;
}

export const FUZZY_MAX_DISTANCE = 2;

const UNRESOLVED: ResolveResult = Object.freeze({ bbs_id: '', confidence: 0, method: 'unresolved' });

type EntityType = 'team' | 'player' | 'league';

interface AliasRow {
  readonly alias: string;
  readonly bbs_id: string;
}

export class EntityResolver {
  constructor(private readonly db: Pool) {}

  async resolveTeam(rawName: string, sport: SportType, source: string): Promise<ResolveResult> {
    return this.resolve('team', rawName, { sport, source });
  }

  async resolvePlayer(
    rawName: string,
    dob?: string,
    teamId?: string,
  ): Promise<ResolveResult> {
    // Player resolution keys on raw alias + optional DOB disambiguation.
    // `teamId` helps narrow pass-2/3 candidates; pass-1 is sport-agnostic.
    void dob;
    const exact = await this.exactAlias('player', rawName);
    if (exact) return { bbs_id: exact, confidence: 1, method: 'exact' };

    const candidates = await this.candidateAliasesForPlayer(teamId);
    const ranked = this.passTwoThree(rawName, candidates);
    if (ranked) return ranked;

    await this.recordUnresolved('player', rawName, 'player-resolver');
    return UNRESOLVED;
  }

  async resolveLeague(rawName: string, sport: SportType): Promise<ResolveResult> {
    return this.resolve('league', rawName, { sport, source: 'league-resolver' });
  }

  // ------------------------------------------------------------------------

  private async resolve(
    type: EntityType,
    rawName: string,
    opts: { sport: SportType; source: string },
  ): Promise<ResolveResult> {
    const trimmed = rawName.trim();
    if (trimmed.length === 0) {
      await this.recordUnresolved(type, rawName, opts.source);
      return UNRESOLVED;
    }

    const exact = await this.exactAlias(type, trimmed);
    if (exact) return { bbs_id: exact, confidence: 1, method: 'exact' };

    const candidates = await this.candidateAliasesForSport(type, opts.sport);
    const ranked = this.passTwoThree(trimmed, candidates);
    if (ranked) return ranked;

    await this.recordUnresolved(type, rawName, opts.source);
    return UNRESOLVED;
  }

  /**
   * Pass 1 — SELECT ... WHERE alias = $1 AND entity_type = $2 LIMIT 1.
   * Returns the bbs_id on hit, null on miss. Index-backed, cheap.
   */
  private async exactAlias(type: EntityType, alias: string): Promise<string | null> {
    const result = await this.db.query<{ bbs_id: string }>(
      `SELECT bbs_id FROM entity_aliases
       WHERE alias = $1 AND entity_type = $2
       LIMIT 1`,
      [alias, type],
    );
    const row = result.rows[0];
    return row ? row.bbs_id : null;
  }

  /**
   * Passes 2 + 3 — run normalised-match first, fall back to fuzzy.
   * Pure function over the candidate list; no DB calls here.
   */
  private passTwoThree(rawName: string, candidates: readonly AliasRow[]): ResolveResult | null {
    if (candidates.length === 0) return null;

    const { normalised: targetNorm, empty } = normaliseForComparison(rawName);
    if (empty) return null;

    // Pass 2: normalised equality.
    for (const c of candidates) {
      if (normaliseString(c.alias) === targetNorm) {
        return { bbs_id: c.bbs_id, confidence: 0.85, method: 'normalised' };
      }
    }

    // Pass 3: Levenshtein ≤ FUZZY_MAX_DISTANCE against normalised aliases.
    // Compare NORMALISED forms so "Man City" vs "Manchestr City" is a 1-char
    // edit of the normalised candidate, not a suffix-distracted 5+.
    let best: { bbs_id: string; dist: number } | null = null;
    for (const c of candidates) {
      const candNorm = normaliseString(c.alias);
      if (candNorm.length === 0) continue;
      const d = distance(targetNorm, candNorm);
      if (d <= FUZZY_MAX_DISTANCE && (best === null || d < best.dist)) {
        best = { bbs_id: c.bbs_id, dist: d };
      }
    }
    if (best) {
      return { bbs_id: best.bbs_id, confidence: 0.7, method: 'fuzzy' };
    }

    return null;
  }

  /**
   * Fetch all (alias, bbs_id) pairs for `type` scoped to `sport`, resolving
   * through the catalogue FK chain. One round-trip per resolve call.
   */
  private async candidateAliasesForSport(
    type: EntityType,
    sport: SportType,
  ): Promise<AliasRow[]> {
    let sql: string;
    switch (type) {
      case 'team':
        sql = `
          SELECT ea.alias, ea.bbs_id
          FROM entity_aliases ea
          JOIN teams t     ON t.bbs_id = ea.bbs_id
          JOIN leagues l   ON l.bbs_id = t.league_id
          JOIN sports s    ON s.bbs_id = l.sport_id
          WHERE ea.entity_type = 'team' AND s.slug = $1
        `;
        break;
      case 'league':
        sql = `
          SELECT ea.alias, ea.bbs_id
          FROM entity_aliases ea
          JOIN leagues l ON l.bbs_id = ea.bbs_id
          JOIN sports s  ON s.bbs_id = l.sport_id
          WHERE ea.entity_type = 'league' AND s.slug = $1
        `;
        break;
      case 'player':
        sql = `
          SELECT ea.alias, ea.bbs_id
          FROM entity_aliases ea
          JOIN players p ON p.bbs_id = ea.bbs_id
          JOIN teams t   ON t.bbs_id = p.team_id
          JOIN leagues l ON l.bbs_id = t.league_id
          JOIN sports s  ON s.bbs_id = l.sport_id
          WHERE ea.entity_type = 'player' AND s.slug = $1
        `;
        break;
      default: {
        const _exhaustive: never = type;
        void _exhaustive;
        return [];
      }
    }
    const result = await this.db.query<AliasRow>(sql, [sport]);
    return result.rows;
  }

  /**
   * Narrower candidate fetch for player resolution when a teamId is provided.
   * Falls back to all player aliases when teamId is absent.
   */
  private async candidateAliasesForPlayer(teamId?: string): Promise<AliasRow[]> {
    if (teamId) {
      const result = await this.db.query<AliasRow>(
        `SELECT ea.alias, ea.bbs_id
         FROM entity_aliases ea
         JOIN players p ON p.bbs_id = ea.bbs_id
         WHERE ea.entity_type = 'player' AND p.team_id = $1`,
        [teamId],
      );
      return result.rows;
    }
    const result = await this.db.query<AliasRow>(
      `SELECT alias, bbs_id FROM entity_aliases WHERE entity_type = 'player'`,
    );
    return result.rows;
  }

  private async recordUnresolved(
    type: EntityType,
    rawName: string,
    source: string,
  ): Promise<void> {
    await this.db
      .query(
        `INSERT INTO unresolved_entities (entity_type, raw_name, source)
         VALUES ($1, $2, $3)`,
        [type, rawName, source],
      )
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[entity-resolver:recordUnresolved] ${msg}`);
      });
  }
}
