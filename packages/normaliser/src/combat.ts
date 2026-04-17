/**
 * MMA + Boxing + combat-athlete normalisation. Target schema: the
 * `combat_athlete`, `mma_bout`, and `boxing_bout` tables from migration 002.
 *
 * The primary source here is the mcp-ufc-stats scraper (see P-06). We
 * accept its parser output shape — a flat record / array of records —
 * and reshape to match Postgres columns.
 */

export type Corner = 'A' | 'B';

export interface CombatAthlete {
  readonly athleteId?: string;
  readonly name: string;
  readonly nationality?: string;
  readonly dob?: string;
  readonly heightCm?: number;
  readonly reachCm?: number;
  readonly stance?: string;
  readonly recordWins: number;
  readonly recordLosses: number;
  readonly recordDraws: number;
  readonly recordNc: number;
  readonly currentRanking?: number;
  readonly weightClass?: string;
  readonly promoter?: string;
  readonly source: string;
}

export interface MmaBout {
  readonly matchId: string;
  readonly cardId?: string;
  readonly eventType?: string;
  readonly boutOrder?: number;
  readonly weightClass?: string;
  readonly scheduledRounds: number;
  readonly titleFight: boolean;
  readonly championshipId?: string;
  readonly resultWinnerId?: string;
  readonly resultMethod?: string;
  readonly resultRound?: number;
  readonly resultTime?: string;
  readonly submissionType?: string;
  readonly judgeScores?: unknown;
  readonly source: string;
}

export interface BoxingBout {
  readonly matchId: string;
  readonly cardId?: string;
  readonly sanctioningBody?: string;
  readonly weightClass?: string;
  readonly scheduledRounds: number;
  readonly resultMethod?: string;
  readonly resultRound?: number;
  readonly resultTime?: string;
  readonly knockdownsA: number;
  readonly knockdownsB: number;
  readonly titleContext?: string;
  readonly judgeScores?: unknown;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Split a raw UFCStats-style method string into a canonical method label.
 *   'KO/TKO' + details containing 'knockout' keyword → 'KO'
 *   'KO/TKO' otherwise                              → 'TKO'
 *   'SUB'                                            → 'SUB'
 *   'U-DEC' / 'S-DEC' / 'M-DEC'                      → 'DEC'
 *   everything else                                  → as-is
 */
export function canoniseMethod(rawMethod: string | null | undefined, details?: string): string | undefined {
  if (!rawMethod) return undefined;
  const up = rawMethod.trim().toUpperCase();
  if (up.startsWith('KO/TKO') || up === 'KO' || up === 'TKO') {
    const det = (details ?? '').toLowerCase();
    // A clean KO is flagged in details — single decisive strike. Absent
    // wording, default to TKO (referee stoppage).
    if (det.includes('knockout') && !det.includes('technical')) return 'KO';
    if (det.includes('(punches)') && /punch|head|kick/.test(det) && det.length < 25) return 'KO';
    return 'TKO';
  }
  if (up.startsWith('SUB')) return 'SUB';
  if (up.includes('DEC')) return 'DEC';
  if (up.includes('DQ')) return 'DQ';
  if (up.includes('NC')) return 'NC';
  return rawMethod.trim();
}

/**
 * Parse "m:ss" or "mm:ss" into a Postgres-friendly TIME string. Returns
 * null if the input is malformed.
 */
export function parseMmSs(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec >= 60) return null;
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return `00:${mm}:${ss}`;
}

/**
 * Parse a fighter record string "W-L-D" or "W-L-D-NC" into its four parts.
 * "Record: 27-1-0 (1 NC)" is also handled.
 */
export function parseRecord(raw: string | null | undefined): {
  wins: number;
  losses: number;
  draws: number;
  nc: number;
} {
  const empty = { wins: 0, losses: 0, draws: 0, nc: 0 };
  if (!raw) return empty;
  const cleaned = raw.replace(/record\s*:?/i, '').trim();

  // Separate out the parenthesised NC count, if any: "27-1-0 (1 NC)".
  const ncMatch = cleaned.match(/\((\d+)\s*NC\)/i);
  const nc = ncMatch && ncMatch[1] ? Number(ncMatch[1]) : 0;
  const coreStr = cleaned.replace(/\(.*?\)/, '').trim();

  const parts = coreStr.split(/[-\s]+/).map((p) => Number(p));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return empty;

  const wins = parts[0] ?? 0;
  const losses = parts[1] ?? 0;
  const draws = parts[2] ?? 0;
  // If the caller already packed NC into the core string ("27-1-0-1") use
  // that over the parenthesised form.
  const fourth = parts[3];
  const finalNc = Number.isFinite(fourth) ? (fourth as number) : nc;

  return { wins, losses, draws, nc: finalNc };
}

// ---------------------------------------------------------------------------
// Public normalisers
// ---------------------------------------------------------------------------

/**
 * Build a CombatAthlete from a mcp-ufc-stats `parseFighterRecord` output
 * (or any compatible blob with the same keys).
 */
export function normaliseCombatAthlete(raw: unknown, source: string): CombatAthlete | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as {
    name?: unknown;
    record?: unknown;
    height?: unknown;
    weight?: unknown;
    reach?: unknown;
    stance?: unknown;
    dob?: unknown;
    nationality?: unknown;
    weight_class?: unknown;
    weightClass?: unknown;
    promoter?: unknown;
    ranking?: unknown;
    athleteId?: unknown;
  };
  const name = asString(r.name);
  if (!name) return null;

  const record = parseRecord(asString(r.record));
  return {
    ...(asString(r.athleteId) ? { athleteId: asString(r.athleteId) as string } : {}),
    name,
    ...(asString(r.nationality) ? { nationality: asString(r.nationality) as string } : {}),
    ...(asString(r.dob) ? { dob: asString(r.dob) as string } : {}),
    ...(num(r.height) !== null ? { heightCm: num(r.height) as number } : {}),
    ...(num(r.reach) !== null ? { reachCm: num(r.reach) as number } : {}),
    ...(asString(r.stance) ? { stance: asString(r.stance) as string } : {}),
    recordWins: record.wins,
    recordLosses: record.losses,
    recordDraws: record.draws,
    recordNc: record.nc,
    ...(num(r.ranking) !== null ? { currentRanking: num(r.ranking) as number } : {}),
    ...(asString(r.weightClass ?? r.weight_class)
      ? { weightClass: asString(r.weightClass ?? r.weight_class) as string }
      : {}),
    ...(asString(r.promoter) ? { promoter: asString(r.promoter) as string } : {}),
    source,
  };
}

/**
 * Normalise an MMA bout. Accepts output from mcp-ufc-stats'
 * `parseFightStats` (with scoreboard-level fields) or a similar upstream.
 *
 * Caller must supply `matchId` externally — there is no natural key in the
 * scraper payload.
 */
export function normaliseMmaBout(raw: unknown, source: string): MmaBout | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as {
    matchId?: unknown;
    match_id?: unknown;
    cardId?: unknown;
    card_id?: unknown;
    eventType?: unknown;
    boutOrder?: unknown;
    bout_order?: unknown;
    weightClass?: unknown;
    weight_class?: unknown;
    scheduledRounds?: unknown;
    rounds?: unknown;
    titleFight?: unknown;
    championshipId?: unknown;
    resultWinnerId?: unknown;
    winnerId?: unknown;
    method?: unknown;
    details?: unknown;
    round?: unknown;
    time?: unknown;
    submission?: unknown;
    submission_type?: unknown;
    judgeScores?: unknown;
  };

  const matchId = asString(r.matchId ?? r.match_id);
  if (!matchId) return null;

  const cardId = asString(r.cardId ?? r.card_id) ?? undefined;
  const method = canoniseMethod(asString(r.method), asString(r.details) ?? undefined);
  const time = parseMmSs(asString(r.time));
  const round = num(r.round);
  const rounds = num(r.scheduledRounds ?? r.rounds) ?? 3;

  return {
    matchId,
    ...(cardId ? { cardId } : {}),
    ...(asString(r.eventType) ? { eventType: asString(r.eventType) as string } : {}),
    ...(num(r.boutOrder ?? r.bout_order) !== null
      ? { boutOrder: num(r.boutOrder ?? r.bout_order) as number }
      : {}),
    ...(asString(r.weightClass ?? r.weight_class)
      ? { weightClass: asString(r.weightClass ?? r.weight_class) as string }
      : {}),
    scheduledRounds: rounds,
    titleFight: r.titleFight === true,
    ...(asString(r.championshipId) ? { championshipId: asString(r.championshipId) as string } : {}),
    ...(asString(r.resultWinnerId ?? r.winnerId)
      ? { resultWinnerId: asString(r.resultWinnerId ?? r.winnerId) as string }
      : {}),
    ...(method ? { resultMethod: method } : {}),
    ...(round !== null ? { resultRound: round } : {}),
    ...(time ? { resultTime: time } : {}),
    ...(asString(r.submission ?? r.submission_type)
      ? { submissionType: asString(r.submission ?? r.submission_type) as string }
      : {}),
    ...(r.judgeScores !== undefined ? { judgeScores: r.judgeScores } : {}),
    source,
  };
}

/**
 * Normalise a boxing bout. Knockdowns per fighter come from the scraper's
 * punch-stats rows when available.
 */
export function normaliseBoxingBout(raw: unknown, source: string): BoxingBout | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as {
    matchId?: unknown;
    match_id?: unknown;
    cardId?: unknown;
    sanctioningBody?: unknown;
    sanctioning_body?: unknown;
    weightClass?: unknown;
    weight_class?: unknown;
    scheduledRounds?: unknown;
    rounds?: unknown;
    method?: unknown;
    round?: unknown;
    time?: unknown;
    knockdownsA?: unknown;
    knockdowns_a?: unknown;
    knockdownsB?: unknown;
    knockdowns_b?: unknown;
    titleContext?: unknown;
    title_context?: unknown;
    judgeScores?: unknown;
  };

  const matchId = asString(r.matchId ?? r.match_id);
  if (!matchId) return null;

  const rounds = num(r.scheduledRounds ?? r.rounds) ?? 12;

  return {
    matchId,
    ...(asString(r.cardId) ? { cardId: asString(r.cardId) as string } : {}),
    ...(asString(r.sanctioningBody ?? r.sanctioning_body)
      ? { sanctioningBody: asString(r.sanctioningBody ?? r.sanctioning_body) as string }
      : {}),
    ...(asString(r.weightClass ?? r.weight_class)
      ? { weightClass: asString(r.weightClass ?? r.weight_class) as string }
      : {}),
    scheduledRounds: rounds,
    ...(asString(r.method) ? { resultMethod: asString(r.method) as string } : {}),
    ...(num(r.round) !== null ? { resultRound: num(r.round) as number } : {}),
    ...(parseMmSs(asString(r.time)) ? { resultTime: parseMmSs(asString(r.time)) as string } : {}),
    knockdownsA: num(r.knockdownsA ?? r.knockdowns_a) ?? 0,
    knockdownsB: num(r.knockdownsB ?? r.knockdowns_b) ?? 0,
    ...(asString(r.titleContext ?? r.title_context)
      ? { titleContext: asString(r.titleContext ?? r.title_context) as string }
      : {}),
    ...(r.judgeScores !== undefined ? { judgeScores: r.judgeScores } : {}),
    source,
  };
}
