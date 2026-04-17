import { describe, expect, it } from 'vitest';
import type { FieldKey, FieldResult } from '@bbs/shared';
import { buildMultiFieldResponse, errorEnvelope } from './response.js';

const REQ_ID = 'req-test-1';

function hit(source: string, confidence: number, via: 'api' | 'cache' | 'mcp' = 'api'): FieldResult {
  return {
    value: { ok: true },
    source,
    via,
    confidence,
    fetchedAt: new Date().toISOString(),
    ttlSeconds: 60,
  };
}

describe('buildMultiFieldResponse', () => {
  it('all results from the same source → 200, source set, no fields_missing', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([
      ['scores', hit('nhl-api', 0.95)],
    ]);
    const { status, body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(status).toBe(200);
    expect(body.meta.source).toBe('nhl-api');
    expect(body.meta.fields_missing).toBeUndefined();
    expect(body.error).toBeNull();
    expect(body.data.scores).not.toBeNull();
  });

  it('mixed sources → source=mixed', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([
      ['scores', hit('nhl-api', 0.95)],
      ['odds', hit('therundown', 0.85)],
    ]);
    const { status, body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(status).toBe(200);
    expect(body.meta.source).toBe('mixed');
  });

  it('all-cache-hit via=cache → cached=true', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([
      ['scores', hit('nhl-api', 0.95, 'cache')],
    ]);
    const { body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(body.meta.cached).toBe(true);
  });

  it('any non-cache result → cached=false', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([
      ['scores', hit('nhl-api', 0.95, 'cache')],
      ['odds', hit('therundown', 0.85, 'api')],
    ]);
    const { body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(body.meta.cached).toBe(false);
  });

  it('all null → 503 with error', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([['scores', null]]);
    const { status, body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(status).toBe(503);
    expect(body.error?.code).toBe('upstream_unavailable');
    expect(body.meta.fields_missing).toEqual(['scores']);
  });

  it('partial success → 200 with fields_missing populated', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([
      ['scores', hit('nhl-api', 0.95)],
      ['odds', null],
    ]);
    const { status, body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(status).toBe(200);
    expect(body.meta.fields_missing).toEqual(['odds']);
    expect(body.data.scores).not.toBeNull();
    expect(body.data.odds).toBeNull();
  });

  it('empty outcomes → 400', () => {
    const { status, body } = buildMultiFieldResponse(new Map(), REQ_ID);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('bad_request');
  });

  it('propagates the request id', () => {
    const outcomes = new Map<FieldKey, FieldResult | null>([['scores', null]]);
    const { body } = buildMultiFieldResponse(outcomes, REQ_ID);
    expect(body.meta.request_id).toBe(REQ_ID);
  });
});

describe('errorEnvelope', () => {
  it('builds a valid error response shell', () => {
    const env = errorEnvelope('bad_request', 'missing foo', REQ_ID);
    expect(env.data).toBeNull();
    expect(env.meta.request_id).toBe(REQ_ID);
    expect(env.error?.code).toBe('bad_request');
  });

  it('includes details when provided', () => {
    const env = errorEnvelope('bad_request', 'x', REQ_ID, { foo: 'bar' });
    expect(env.error?.details).toEqual({ foo: 'bar' });
  });
});
