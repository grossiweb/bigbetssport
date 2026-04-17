import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BASE_MS,
  DEFAULT_MAX_MS,
  calculateBackoff,
  withBackoff,
} from './backoff.js';

describe('calculateBackoff', () => {
  it('grows exponentially in base-ms units', () => {
    const d0 = calculateBackoff(0, undefined, { jitterMs: 0 });
    const d1 = calculateBackoff(1, undefined, { jitterMs: 0 });
    const d2 = calculateBackoff(2, undefined, { jitterMs: 0 });
    expect(d0).toBe(DEFAULT_BASE_MS);
    expect(d1).toBe(DEFAULT_BASE_MS * 2);
    expect(d2).toBe(DEFAULT_BASE_MS * 4);
  });

  it('caps at maxMs', () => {
    const huge = calculateBackoff(20, undefined, { jitterMs: 0 });
    expect(huge).toBe(DEFAULT_MAX_MS);
  });

  it('respects Retry-After when provided', () => {
    const d = calculateBackoff(0, 3_000);
    expect(d).toBe(3_000);
  });

  it('still caps Retry-After at maxMs', () => {
    const d = calculateBackoff(0, 999_999);
    expect(d).toBe(DEFAULT_MAX_MS);
  });

  it('ignores non-positive Retry-After', () => {
    const d = calculateBackoff(0, 0, { jitterMs: 0 });
    expect(d).toBe(DEFAULT_BASE_MS);
  });

  it('applies jitter up to jitterMs', () => {
    const d = calculateBackoff(0, undefined, { jitterMs: 500, randomFn: () => 0.5 });
    // 1000 (base) + 0.5 * 500 = 1250
    expect(d).toBe(1_250);
  });
});

describe('withBackoff', () => {
  it('returns the value on first success', async () => {
    const fn = vi.fn<() => Promise<string>>().mockResolvedValue('ok');
    const result = await withBackoff(fn, { maxAttempts: 3, sleep: async () => {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'))
      .mockResolvedValue('done');
    const result = await withBackoff(fn, { maxAttempts: 5, sleep: async () => {} });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows after maxAttempts', async () => {
    const err = new Error('boom');
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);
    await expect(
      withBackoff(fn, { maxAttempts: 2, sleep: async () => {} }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops early when shouldRetry returns false', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('nope'));
    await expect(
      withBackoff(fn, { maxAttempts: 5, shouldRetry: () => false, sleep: async () => {} }),
    ).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After extracted from the error', async () => {
    const sleepSpy = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { retryAfterMs: 5_000 }))
      .mockResolvedValue('ok');

    await withBackoff(fn, {
      maxAttempts: 3,
      sleep: sleepSpy,
      retryAfterFromError: (err) => (err as { retryAfterMs?: number }).retryAfterMs,
      jitterMs: 0,
    });

    expect(sleepSpy).toHaveBeenCalledWith(5_000);
  });
});
