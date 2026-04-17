import { describe, expect, it } from 'vitest';
import {
  canoniseMethod,
  normaliseBoxingBout,
  normaliseCombatAthlete,
  normaliseMmaBout,
  parseMmSs,
  parseRecord,
} from './combat.js';

describe('parseRecord', () => {
  it('parses W-L-D format', () => {
    expect(parseRecord('27-1-0')).toEqual({ wins: 27, losses: 1, draws: 0, nc: 0 });
  });

  it('parses W-L-D (N NC) format', () => {
    expect(parseRecord('27-1-0 (1 NC)')).toEqual({ wins: 27, losses: 1, draws: 0, nc: 1 });
  });

  it('parses W-L-D-NC flat format', () => {
    expect(parseRecord('30-2-1-2')).toEqual({ wins: 30, losses: 2, draws: 1, nc: 2 });
  });

  it('handles "Record: ..." prefix', () => {
    expect(parseRecord('Record: 19-0-0')).toMatchObject({ wins: 19, losses: 0, draws: 0 });
  });

  it('returns zeros for unparseable input', () => {
    expect(parseRecord(null)).toEqual({ wins: 0, losses: 0, draws: 0, nc: 0 });
    expect(parseRecord('???')).toEqual({ wins: 0, losses: 0, draws: 0, nc: 0 });
  });
});

describe('parseMmSs', () => {
  it('pads to 00:MM:SS', () => {
    expect(parseMmSs('3:45')).toBe('00:03:45');
    expect(parseMmSs('12:08')).toBe('00:12:08');
  });
  it('returns null for bad input', () => {
    expect(parseMmSs('abc')).toBeNull();
    expect(parseMmSs('3:99')).toBeNull();
    expect(parseMmSs(null)).toBeNull();
  });
});

describe('canoniseMethod', () => {
  it('splits KO/TKO by details content', () => {
    expect(canoniseMethod('KO/TKO', 'Knockout (Punches)')).toBe('KO');
    expect(canoniseMethod('KO/TKO', 'Technical Knockout (Strikes)')).toBe('TKO');
    expect(canoniseMethod('KO/TKO', '')).toBe('TKO');
  });

  it('maps SUB variants to SUB', () => {
    expect(canoniseMethod('SUBMISSION')).toBe('SUB');
    expect(canoniseMethod('SUB')).toBe('SUB');
  });

  it('maps decision variants to DEC', () => {
    expect(canoniseMethod('U-DEC')).toBe('DEC');
    expect(canoniseMethod('S-DEC')).toBe('DEC');
    expect(canoniseMethod('M-DEC')).toBe('DEC');
  });
});

describe('normaliseCombatAthlete', () => {
  it('parses a ufcstats-style record + physicals', () => {
    const raw = {
      name: 'Jon Jones',
      record: 'Record: 27-1-0 (1 NC)',
      height: 193,
      reach: 84,
      stance: 'Orthodox',
      dob: '1987-07-19',
      weightClass: 'Light Heavyweight',
    };
    const a = normaliseCombatAthlete(raw, 'mcp-ufc-stats');
    expect(a).not.toBeNull();
    expect(a!.name).toBe('Jon Jones');
    expect(a!.recordWins).toBe(27);
    expect(a!.recordLosses).toBe(1);
    expect(a!.recordDraws).toBe(0);
    expect(a!.recordNc).toBe(1);
    expect(a!.stance).toBe('Orthodox');
    expect(a!.weightClass).toBe('Light Heavyweight');
    expect(a!.source).toBe('mcp-ufc-stats');
  });

  it('rejects a payload with no name', () => {
    expect(normaliseCombatAthlete({ record: '10-0-0' }, 'x')).toBeNull();
  });
});

describe('normaliseMmaBout', () => {
  it('canonicalises KO/TKO → KO when details indicate knockout', () => {
    const raw = {
      matchId: 'm-1',
      method: 'KO/TKO',
      details: 'Knockout (Punches)',
      round: 2,
      time: '3:45',
      rounds: 3,
    };
    const bout = normaliseMmaBout(raw, 'mcp-ufc-stats');
    expect(bout).not.toBeNull();
    expect(bout!.resultMethod).toBe('KO');
    expect(bout!.resultRound).toBe(2);
    expect(bout!.resultTime).toBe('00:03:45');
    expect(bout!.scheduledRounds).toBe(3);
    expect(bout!.titleFight).toBe(false);
  });

  it('canonicalises KO/TKO → TKO when details mention technical', () => {
    const raw = {
      matchId: 'm-2',
      method: 'KO/TKO',
      details: 'Technical Knockout (Elbows)',
      round: 4,
      time: '1:20',
    };
    const bout = normaliseMmaBout(raw, 'mcp-ufc-stats');
    expect(bout!.resultMethod).toBe('TKO');
  });

  it('returns null without matchId', () => {
    expect(normaliseMmaBout({ method: 'DEC' }, 'x')).toBeNull();
  });
});

describe('normaliseBoxingBout', () => {
  it('defaults scheduled rounds to 12 when absent', () => {
    const b = normaliseBoxingBout(
      { matchId: 'b-1', method: 'KO', round: 6, time: '1:45', knockdowns_a: 2 },
      'mcp-boxrec',
    );
    expect(b!.scheduledRounds).toBe(12);
    expect(b!.knockdownsA).toBe(2);
    expect(b!.knockdownsB).toBe(0);
    expect(b!.resultTime).toBe('00:01:45');
  });
});
