import { describe, expect, it } from 'vitest';
import sportmonksAdapter, { SPORTMONKS_FREE_LEAGUE_IDS } from './sportmonks.js';

describe('sportmonksAdapter', () => {
  it('confidence = 0.85', () => {
    expect(sportmonksAdapter.confidence).toBe(0.85);
  });

  it('whitelist = Danish Superliga (271) + Scottish Premiership (501)', () => {
    expect(SPORTMONKS_FREE_LEAGUE_IDS.has('271')).toBe(true);
    expect(SPORTMONKS_FREE_LEAGUE_IDS.has('501')).toBe(true);
    expect(SPORTMONKS_FREE_LEAGUE_IDS.size).toBe(2);
  });

  it('returns null for a league id outside the free-plan whitelist', () => {
    const req = sportmonksAdapter.buildRequest('odds', {
      sport: 'football',
      matchId: '100',
      leagueId: '39', // Premier League — paid
    });
    expect(req).toBeNull();
  });

  it('allows Danish Superliga (271)', () => {
    const req = sportmonksAdapter.buildRequest('odds', {
      sport: 'football',
      matchId: '100',
      leagueId: '271',
    });
    expect(req).not.toBeNull();
    expect(req!.url).toContain('/odds/pre-match/fixtures/100');
  });

  it('allows Scottish Premiership (501)', () => {
    const req = sportmonksAdapter.buildRequest('lineups', {
      sport: 'football',
      matchId: '200',
      leagueId: '501',
    });
    expect(req).not.toBeNull();
    const url = new URL(req!.url);
    expect(url.pathname).toBe('/api/v3.0/fixtures/200');
    expect(url.searchParams.get('include')).toBe('lineups;statistics');
  });

  it('combines lineups and statistics in one ?include= call', () => {
    const req = sportmonksAdapter.buildRequest('stats', {
      sport: 'football',
      matchId: '300',
      leagueId: '271',
    });
    expect(req).not.toBeNull();
    expect(new URL(req!.url).searchParams.get('include')).toBe('lineups;statistics');
  });

  it('returns null for non-football sports', () => {
    expect(sportmonksAdapter.buildRequest('odds', { sport: 'basketball', matchId: '1' })).toBeNull();
  });

  it('returns null when no matchId provided', () => {
    expect(sportmonksAdapter.buildRequest('odds', { sport: 'football', leagueId: '271' })).toBeNull();
  });

  it('supports xg via expectedGoals include', () => {
    const req = sportmonksAdapter.buildRequest('xg', {
      sport: 'football',
      matchId: '400',
      leagueId: '271',
    });
    expect(req).not.toBeNull();
    expect(new URL(req!.url).searchParams.get('include')).toBe('expectedGoals');
  });
});
