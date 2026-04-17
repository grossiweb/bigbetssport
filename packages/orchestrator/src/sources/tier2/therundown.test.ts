import { describe, expect, it } from 'vitest';
import theRundownAdapter, {
  THERUNDOWN_SPORT_IDS,
  THERUNDOWN_AUTH_HEADER,
  THERUNDOWN_ENV_KEY,
  buildTheRundownDeltaRequest,
} from './therundown.js';

describe('theRundownAdapter', () => {
  it('has expected constants', () => {
    expect(theRundownAdapter.sourceId).toBe('therundown');
    expect(theRundownAdapter.confidence).toBe(0.85);
    expect(THERUNDOWN_AUTH_HEADER).toBe('X-TheRundown-Key');
    expect(THERUNDOWN_ENV_KEY).toBe('RUNDOWN_API_KEY');
  });

  it('maps BBS sports to TheRundown sport ids', () => {
    expect(THERUNDOWN_SPORT_IDS.american_football).toEqual([2]);
    expect(THERUNDOWN_SPORT_IDS.basketball).toEqual([4]);
    expect(THERUNDOWN_SPORT_IDS.baseball).toEqual([3]);
    expect(THERUNDOWN_SPORT_IDS.ice_hockey).toEqual([6]);
    expect(THERUNDOWN_SPORT_IDS.football).toContain(10);
    expect(THERUNDOWN_SPORT_IDS.football.length).toBeGreaterThan(1);
  });

  it('buildRequest(scores) targets /sports/{id}/events/{date} with market filters', () => {
    const req = theRundownAdapter.buildRequest('scores', {
      sport: 'basketball',
      date: '2026-04-17',
    });
    expect(req).not.toBeNull();
    const url = new URL(req!.url);
    expect(url.pathname).toBe('/api/v2/sports/4/events/2026-04-17');
    expect(url.searchParams.get('market_ids')).toBe('1,2,3');
    expect(url.searchParams.get('affiliate_ids')).toBe('19,23');
    expect(url.searchParams.get('main_line')).toBe('true');
  });

  it('buildRequest(odds) works the same as scores', () => {
    const req = theRundownAdapter.buildRequest('odds', {
      sport: 'ice_hockey',
      date: '2026-04-17',
    });
    expect(req).not.toBeNull();
    expect(req!.url).toContain('/sports/6/events/2026-04-17');
  });

  it('returns null for unsupported sports (cricket)', () => {
    expect(theRundownAdapter.buildRequest('scores', { sport: 'cricket' })).toBeNull();
    expect(theRundownAdapter.buildRequest('odds', { sport: 'formula1' })).toBeNull();
  });

  it('returns null for unsupported fields', () => {
    expect(theRundownAdapter.buildRequest('players', { sport: 'basketball' })).toBeNull();
    expect(theRundownAdapter.buildRequest('xg', { sport: 'football' })).toBeNull();
  });

  it('extractField(scores) unwraps events from response', () => {
    const data = { events: [{ id: 'e1' }] };
    expect(theRundownAdapter.extractField('scores', data)).toEqual([{ id: 'e1' }]);
  });

  it('buildTheRundownDeltaRequest attaches X-TheRundown-Key header', () => {
    const req = buildTheRundownDeltaRequest(4, 'cursor-abc', 'my-api-key');
    expect(req.headers.get('X-TheRundown-Key')).toBe('my-api-key');
    const url = new URL(req.url);
    expect(url.pathname).toBe('/api/v2/markets/delta');
    expect(url.searchParams.get('last_id')).toBe('cursor-abc');
    expect(url.searchParams.get('sport_id')).toBe('4');
  });

  it('buildTheRundownDeltaRequest skips header when apiKey missing', () => {
    const req = buildTheRundownDeltaRequest(4, null, undefined);
    expect(req.headers.has('X-TheRundown-Key')).toBe(false);
  });
});
