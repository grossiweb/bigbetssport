import { describe, expect, it } from 'vitest';
import nhlAdapter from './nhl.js';

describe('nhlAdapter', () => {
  it('has the expected source id and confidence', () => {
    expect(nhlAdapter.sourceId).toBe('nhl-api');
    expect(nhlAdapter.confidence).toBe(0.95);
  });

  it('buildRequest(scores) returns a Request at /scoreboard/now when no date given', () => {
    const req = nhlAdapter.buildRequest('scores', { sport: 'ice_hockey' });
    expect(req).not.toBeNull();
    expect(req!.url).toBe('https://api-web.nhle.com/v1/scoreboard/now');
    expect(req!.method).toBe('GET');
  });

  it('buildRequest(scores) with date returns /schedule/{date}', () => {
    const req = nhlAdapter.buildRequest('scores', {
      sport: 'ice_hockey',
      date: '2026-04-17',
    });
    expect(req!.url).toBe('https://api-web.nhle.com/v1/schedule/2026-04-17');
  });

  it('buildRequest(standings) returns /standings/now', () => {
    const req = nhlAdapter.buildRequest('standings', { sport: 'ice_hockey' });
    expect(req!.url).toBe('https://api-web.nhle.com/v1/standings/now');
  });

  it('returns null for non-hockey sports', () => {
    expect(nhlAdapter.buildRequest('scores', { sport: 'football' })).toBeNull();
    expect(nhlAdapter.buildRequest('scores', { sport: 'basketball' })).toBeNull();
  });

  it('returns null for unsupported fields', () => {
    expect(nhlAdapter.buildRequest('odds', { sport: 'ice_hockey' })).toBeNull();
    expect(nhlAdapter.buildRequest('xg', { sport: 'ice_hockey' })).toBeNull();
  });

  it('extractField(scores) unwraps "games" when present', () => {
    const data = { games: [{ id: 1 }, { id: 2 }] };
    expect(nhlAdapter.extractField('scores', data)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('extractField returns null for non-object data', () => {
    expect(nhlAdapter.extractField('scores', null)).toBeNull();
    expect(nhlAdapter.extractField('scores', 'string')).toBeNull();
  });
});
