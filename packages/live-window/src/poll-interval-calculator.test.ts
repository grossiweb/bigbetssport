import { describe, expect, it } from 'vitest';
import { getPollIntervalMs, POLL_INTERVALS } from './poll-interval-calculator.js';

describe('getPollIntervalMs', () => {
  it('live + scores → 5000ms', () => {
    expect(getPollIntervalMs('football', 'scores', true)).toBe(5_000);
    expect(getPollIntervalMs('football', 'scores', true)).toBe(POLL_INTERVALS.LIVE_SCORES_MS);
  });

  it('live + odds → 10000ms', () => {
    expect(getPollIntervalMs('basketball', 'odds', true)).toBe(10_000);
  });

  it('live + any other field → 15000ms', () => {
    expect(getPollIntervalMs('football', 'lineups', true)).toBe(15_000);
    expect(getPollIntervalMs('football', 'injuries', true)).toBe(15_000);
  });

  it('pre-match scores/odds → 30000ms', () => {
    expect(getPollIntervalMs('football', 'scores', false)).toBe(30_000);
    expect(getPollIntervalMs('baseball', 'odds', false)).toBe(30_000);
  });

  it('pre-match lineups → 60000ms', () => {
    expect(getPollIntervalMs('football', 'lineups', false)).toBe(60_000);
  });

  it('pre-match / idle for slow fields → 120000ms', () => {
    expect(getPollIntervalMs('football', 'historical', false)).toBe(120_000);
    expect(getPollIntervalMs('football', 'standings', false)).toBe(120_000);
    expect(getPollIntervalMs('football', 'transfers', false)).toBe(120_000);
  });
});
