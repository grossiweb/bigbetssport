import type { FieldKey } from '@bbs/shared';
import type { EntityResolver } from './entity-resolver.js';
import type { NormalisedPayload } from './types.js';
import {
  normaliseBallDontLieStats,
  normaliseFplPlayers,
  normaliseMlbScores,
  normaliseNhlScores,
  normaliseOpenLigaDbScores,
  normaliseTheRundownOdds,
  normaliseTheRundownScores,
} from './sources/index.js';

/**
 * Canonical entry point. Dispatches on `(sourceId, field)` to the matching
 * per-source normaliser. Returns null when we don't have a normaliser for
 * that tuple yet (the field router still caches the raw result in that
 * case; storage just can't ingest it).
 */

type Normaliser = (
  raw: unknown,
  resolver: EntityResolver,
  sourceId: string,
) => Promise<NormalisedPayload | null>;

const NORMALISERS = new Map<string, Normaliser>([
  ['nhl-api:scores', normaliseNhlScores],
  ['mlb-api:scores', normaliseMlbScores],
  ['openligadb:scores', normaliseOpenLigaDbScores],
  ['therundown:scores', normaliseTheRundownScores],
  ['therundown:odds', normaliseTheRundownOdds],
  ['balldontlie:stats', normaliseBallDontLieStats],
  ['fpl:players', normaliseFplPlayers],
]);

export async function normaliseMatchData(
  raw: unknown,
  sourceId: string,
  field: FieldKey,
  resolver: EntityResolver,
): Promise<NormalisedPayload | null> {
  const fn = NORMALISERS.get(`${sourceId}:${field}`);
  if (!fn) {
    // TODO(P-05+): add normalisers for the remaining (source, field) combos.
    // Not-having-one is a cache-only miss, not an error.
    return null;
  }
  return fn(raw, resolver, sourceId);
}

/**
 * Read-only export for tests + introspection.
 */
export function listNormaliserKeys(): readonly string[] {
  return Array.from(NORMALISERS.keys());
}
