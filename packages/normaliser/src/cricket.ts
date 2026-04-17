/**
 * Cricket-specific normalisation. Maps CricketData.org responses onto the
 * `cricket_match_state`, `cricket_batting_scorecard`, and
 * `cricket_bowling_scorecard` shapes from migration 002.
 *
 * These normalisers don't touch the entity resolver — cricket teams and
 * players are identified by the upstream's own ids for now. A later P
 * prompt should fold them into the canonical alias table.
 */

export interface CricketMatchState {
  readonly matchId: string;
  readonly inningsNumber: number;
  readonly battingTeamId: string;
  readonly oversBowled: number;
  readonly runScored: number;
  readonly wicketsFallen: number;
  readonly target?: number;
  readonly requiredRunRate?: number;
  readonly currentRunRate?: number;
  readonly dlsTarget?: number;
  readonly resultMethod?: string;
  readonly source: string;
}

export interface BattingEntry {
  readonly playerId: string;
  readonly playerName?: string;
  readonly runs: number;
  readonly balls: number;
  readonly fours: number;
  readonly sixes: number;
  readonly strikeRate?: number;
  readonly dismissalType?: string;
}

export interface BowlingEntry {
  readonly playerId: string;
  readonly playerName?: string;
  readonly overs: number;
  readonly maidens: number;
  readonly runs: number;
  readonly wickets: number;
  readonly economy?: number;
  readonly wides: number;
  readonly noBalls: number;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

/**
 * CricketData.org live-score shape (simplified):
 *
 *   { id, name, status, teams: ['A','B'],
 *     score: [
 *       { r: 255, w: 4, o: 20.0, inning: 'A Innings 1' },
 *       ...
 *     ],
 *     teamInfo: [{ name, shortname }, ...] }
 *
 * We pick the most recent `score` entry as the current innings state.
 */
export function normaliseCricketMatchState(
  raw: unknown,
  source: string,
): CricketMatchState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const data = (raw as { data?: unknown }).data ?? raw;
  if (data === null || typeof data !== 'object') return null;

  const matchId = asString((data as { id?: unknown }).id);
  if (!matchId) return null;

  const scores = (data as { score?: unknown[] }).score;
  if (!Array.isArray(scores) || scores.length === 0) return null;

  // "Current" innings = the last entry in the score array. Upstream writes
  // them in innings order.
  const current = scores[scores.length - 1];
  if (current === null || typeof current !== 'object') return null;
  const c = current as {
    r?: unknown;
    w?: unknown;
    o?: unknown;
    inning?: unknown;
  };

  const inningsLabel = asString(c.inning) ?? '';
  const inningsNumber = parseInningsNumber(inningsLabel);
  const runs = num(c.r) ?? 0;
  const wickets = num(c.w) ?? 0;
  const overs = num(c.o) ?? 0;

  const battingTeamId = parseBattingTeamId(inningsLabel, data);
  const currentRunRate = overs > 0 ? Number((runs / overs).toFixed(2)) : undefined;

  // Target / RRR — only defined when we have a first innings to chase.
  let target: number | undefined;
  let requiredRunRate: number | undefined;
  if (scores.length >= 2 && inningsNumber === 2) {
    const prev = scores[0];
    if (prev !== null && typeof prev === 'object') {
      const firstRuns = num((prev as { r?: unknown }).r);
      if (firstRuns !== null) {
        target = firstRuns + 1;
        const oversRemaining = Math.max(0, 20 - overs); // default T20; real source should derive.
        if (oversRemaining > 0) {
          requiredRunRate = Number(((target - runs) / oversRemaining).toFixed(2));
        }
      }
    }
  }

  return {
    matchId,
    inningsNumber,
    battingTeamId,
    oversBowled: overs,
    runScored: runs,
    wicketsFallen: wickets,
    ...(target !== undefined ? { target } : {}),
    ...(requiredRunRate !== undefined ? { requiredRunRate } : {}),
    ...(currentRunRate !== undefined ? { currentRunRate } : {}),
    resultMethod: asString((data as { resultMethod?: unknown }).resultMethod) ?? undefined,
    source,
  };
}

function parseInningsNumber(label: string): number {
  const m = label.match(/Innings\s+(\d+)/i);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

function parseBattingTeamId(inningsLabel: string, data: unknown): string {
  // The team id in CricketData.org responses is usually absent; we fall
  // back to the team NAME from the innings label.
  const splitIdx = inningsLabel.toLowerCase().indexOf('innings');
  if (splitIdx > 0) return inningsLabel.slice(0, splitIdx).trim();
  const teams = (data as { teams?: unknown }).teams;
  if (Array.isArray(teams) && typeof teams[0] === 'string') return teams[0];
  return 'unknown';
}

/**
 * CricketData.org scorecard shape:
 *
 *   { data: { scorecard: [ { inning, batting: [...], bowling: [...] }, ... ] } }
 */
export function normaliseCricketScorecard(
  raw: unknown,
): { batting: BattingEntry[]; bowling: BowlingEntry[] } {
  const out = { batting: [] as BattingEntry[], bowling: [] as BowlingEntry[] };
  if (raw === null || typeof raw !== 'object') return out;
  const data = (raw as { data?: unknown }).data ?? raw;
  if (data === null || typeof data !== 'object') return out;

  const cards = (data as { scorecard?: unknown[] }).scorecard;
  if (!Array.isArray(cards)) return out;

  for (const inningsRaw of cards) {
    if (inningsRaw === null || typeof inningsRaw !== 'object') continue;
    const batting = (inningsRaw as { batting?: unknown[] }).batting ?? [];
    const bowling = (inningsRaw as { bowling?: unknown[] }).bowling ?? [];

    for (const b of batting) {
      const entry = parseBatting(b);
      if (entry) out.batting.push(entry);
    }
    for (const b of bowling) {
      const entry = parseBowling(b);
      if (entry) out.bowling.push(entry);
    }
  }
  return out;
}

function parseBatting(raw: unknown): BattingEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as {
    batsman?: { id?: string; name?: string };
    batsman_id?: string;
    player?: string;
    r?: unknown;
    b?: unknown;
    fours?: unknown;
    sixes?: unknown;
    ['4s']?: unknown;
    ['6s']?: unknown;
    sr?: unknown;
    dismissal?: unknown;
    ['dismissal-text']?: unknown;
  };
  const playerId = r.batsman?.id ?? r.batsman_id ?? r.batsman?.name ?? asString(r.player) ?? null;
  if (!playerId) return null;
  return {
    playerId,
    ...(r.batsman?.name !== undefined ? { playerName: r.batsman.name } : {}),
    runs: num(r.r) ?? 0,
    balls: num(r.b) ?? 0,
    fours: num(r.fours ?? r['4s']) ?? 0,
    sixes: num(r.sixes ?? r['6s']) ?? 0,
    ...(num(r.sr) !== null ? { strikeRate: num(r.sr) ?? undefined } : {}),
    ...(asString(r.dismissal ?? r['dismissal-text']) !== null
      ? { dismissalType: asString(r.dismissal ?? r['dismissal-text']) ?? undefined }
      : {}),
  };
}

function parseBowling(raw: unknown): BowlingEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as {
    bowler?: { id?: string; name?: string };
    bowler_id?: string;
    player?: string;
    o?: unknown;
    m?: unknown;
    r?: unknown;
    w?: unknown;
    eco?: unknown;
    wd?: unknown;
    nb?: unknown;
  };
  const playerId = r.bowler?.id ?? r.bowler_id ?? r.bowler?.name ?? asString(r.player) ?? null;
  if (!playerId) return null;
  return {
    playerId,
    ...(r.bowler?.name !== undefined ? { playerName: r.bowler.name } : {}),
    overs: num(r.o) ?? 0,
    maidens: num(r.m) ?? 0,
    runs: num(r.r) ?? 0,
    wickets: num(r.w) ?? 0,
    ...(num(r.eco) !== null ? { economy: num(r.eco) ?? undefined } : {}),
    wides: num(r.wd) ?? 0,
    noBalls: num(r.nb) ?? 0,
  };
}
