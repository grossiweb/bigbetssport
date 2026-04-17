/**
 * Exponential backoff with jitter, respecting upstream Retry-After hints.
 *
 * Used by the ingest workers and any other code that retries upstream calls.
 * Kept as pure functions so the policy is trivially testable — a fake
 * `randomFn` can be injected to make jitter deterministic in tests.
 */

export interface BackoffOptions {
  readonly maxAttempts?: number;
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly jitterMs?: number;
  /** Injection point for deterministic tests. Defaults to `Math.random`. */
  readonly randomFn?: () => number;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BASE_MS = 1_000;
export const DEFAULT_MAX_MS = 60_000;
export const DEFAULT_JITTER_MS = 500;

/**
 * Return a delay in milliseconds for the given attempt index (0-based).
 *
 * - If `retryAfterMs` is provided and positive, it wins. The upstream server
 *   told us how long to wait; respect that, capped to `maxMs`.
 * - Otherwise: `min(baseMs * 2^attempt + jitter(0..jitterMs), maxMs)`.
 */
export function calculateBackoff(
  attempt: number,
  retryAfterMs?: number,
  opts: BackoffOptions = {},
): number {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const max = opts.maxMs ?? DEFAULT_MAX_MS;
  const jitter = opts.jitterMs ?? DEFAULT_JITTER_MS;
  const rnd = opts.randomFn ?? Math.random;

  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, max);
  }

  const exp = base * Math.pow(2, Math.max(0, attempt));
  const withJitter = exp + rnd() * jitter;
  return Math.min(Math.floor(withJitter), max);
}

export interface WithBackoffOptions extends BackoffOptions {
  /** Injection point for `setTimeout`-equivalent; tests pass a fake. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Optional predicate that decides whether a given error should be retried.
   * By default, every thrown error is retried until attempts are exhausted.
   */
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
  /**
   * Optional extractor that pulls a Retry-After (ms) hint out of an error.
   * If the error is an upstream `UpstreamError` with a 429 status and a
   * parseable Retry-After header, wire this up to return the parsed ms.
   */
  readonly retryAfterFromError?: (err: unknown) => number | undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run `fn` with exponential backoff. Returns the first successful result, or
 * rethrows the final error after `maxAttempts` retries.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: WithBackoffOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? ((): boolean => true);
  const retryAfterFromError = options.retryAfterFromError;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) break;
      if (!shouldRetry(err, attempt)) break;

      const retryAfter = retryAfterFromError?.(err);
      const delay = calculateBackoff(attempt, retryAfter, options);
      await sleep(delay);
    }
  }
  throw lastError;
}
