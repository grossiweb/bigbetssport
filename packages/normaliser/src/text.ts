/**
 * Text normalisation helpers used by the entity resolver's pass 2.
 *
 * The goal is to collapse aliases like "Manchester City FC" and "Man City"
 * onto the same normalised key. We strip suffixes, punctuation, accents,
 * and case — leaving a spartan lowercase identifier.
 */

// Common club / team suffixes across multiple sports and locales.
const SUFFIXES: readonly string[] = [
  'FC',
  'CF',
  'SC',
  'SK',
  'FK',
  'SV',
  'AC',
  'AS',
  'SS',
  'RC',
  'AFC',
  'United',
  'City',
];

// Pre-compile a word-boundary regex that strips any trailing or inner suffix
// token. `\b` on Unicode letters is unreliable, so we operate on
// whitespace-delimited words after the preceding normalisation passes.
const SUFFIX_SET = new Set(SUFFIXES.map((s) => s.toLowerCase()));

/**
 * Strip combining diacritics via NFD → ASCII. Handles é → e, ø → o, ß → ss (*).
 * (*) ß isn't a combining diacritic; we add a small explicit table.
 */
function stripAccents(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/œ/gi, 'oe');
}

/**
 * Canonical normalisation:
 *   1. Strip diacritics
 *   2. Lowercase
 *   3. Replace non-alphanumeric with single space
 *   4. Tokenise, drop known suffixes, rejoin with single spaces
 *   5. Trim
 */
export function normaliseString(input: string): string {
  const stripped = stripAccents(input).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (stripped.length === 0) return '';
  const words = stripped.split(/\s+/).filter((w) => !SUFFIX_SET.has(w));
  return words.join(' ');
}

/**
 * Comparable key for passes 2 and 3. Returns the normalised form plus a
 * flag indicating whether ALL content was dropped (e.g. input was only
 * suffix words). Callers should treat empty normalisation as a miss.
 */
export function normaliseForComparison(input: string): { normalised: string; empty: boolean } {
  const normalised = normaliseString(input);
  return { normalised, empty: normalised.length === 0 };
}
