import { describe, expect, it } from 'vitest';
import { normaliseCricketMatchState, normaliseCricketScorecard } from './cricket.js';

/**
 * Fixture shaped like a CricketData.org /match_scorecard response for a
 * T20 with India chasing England's total.
 */
const MATCH_STATE_FIXTURE = {
  status: 'success',
  data: {
    id: 'abc-123',
    name: 'India vs England, 2nd T20I',
    status: 'India require 40 runs',
    teams: ['England', 'India'],
    score: [
      { r: 180, w: 6, o: 20.0, inning: 'England Innings 1' },
      { r: 141, w: 4, o: 15.0, inning: 'India Innings 1' },
    ],
  },
};

const SCORECARD_FIXTURE = {
  data: {
    scorecard: [
      {
        inning: 'England Innings 1',
        batting: [
          {
            batsman: { id: 'jos-buttler', name: 'Jos Buttler' },
            r: 65,
            b: 42,
            '4s': 6,
            '6s': 3,
            sr: 154.76,
            'dismissal-text': 'c Kohli b Bumrah',
          },
          {
            batsman: { id: 'jonny-bairstow', name: 'Jonny Bairstow' },
            r: 30,
            b: 25,
            '4s': 2,
            '6s': 1,
            sr: 120.0,
            dismissal: 'run out',
          },
        ],
        bowling: [
          {
            bowler: { id: 'jasprit-bumrah', name: 'Jasprit Bumrah' },
            o: 4.0,
            m: 1,
            r: 28,
            w: 3,
            eco: 7.0,
            wd: 1,
            nb: 0,
          },
        ],
      },
    ],
  },
};

describe('normaliseCricketMatchState', () => {
  it('parses CricketData.org match_scorecard shape correctly', () => {
    const state = normaliseCricketMatchState(MATCH_STATE_FIXTURE, 'cricketdata');
    expect(state).not.toBeNull();
    expect(state!.matchId).toBe('abc-123');
    expect(state!.battingTeamId).toBe('India');
    expect(state!.inningsNumber).toBe(1);
    expect(state!.oversBowled).toBe(15.0);
    expect(state!.runScored).toBe(141);
    expect(state!.wicketsFallen).toBe(4);
    expect(state!.source).toBe('cricketdata');
    // Current RR = runs / overs
    expect(state!.currentRunRate).toBeCloseTo(9.4, 1);
  });

  it('returns null for non-object input', () => {
    expect(normaliseCricketMatchState(null, 'x')).toBeNull();
    expect(normaliseCricketMatchState('junk', 'x')).toBeNull();
  });

  it('returns null when score array is missing', () => {
    expect(
      normaliseCricketMatchState({ data: { id: 'x', score: [] } }, 'x'),
    ).toBeNull();
  });
});

describe('normaliseCricketScorecard', () => {
  it('parses batting + bowling rows', () => {
    const { batting, bowling } = normaliseCricketScorecard(SCORECARD_FIXTURE);
    expect(batting).toHaveLength(2);
    expect(batting[0]).toMatchObject({
      playerId: 'jos-buttler',
      runs: 65,
      balls: 42,
      fours: 6,
      sixes: 3,
      dismissalType: 'c Kohli b Bumrah',
    });
    expect(batting[1]?.dismissalType).toBe('run out');
    expect(bowling).toHaveLength(1);
    expect(bowling[0]).toMatchObject({
      playerId: 'jasprit-bumrah',
      overs: 4,
      maidens: 1,
      runs: 28,
      wickets: 3,
      wides: 1,
      noBalls: 0,
    });
  });

  it('returns empty arrays for malformed input', () => {
    const res = normaliseCricketScorecard('garbage');
    expect(res.batting).toEqual([]);
    expect(res.bowling).toEqual([]);
  });
});
