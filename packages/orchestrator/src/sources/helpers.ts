/**
 * Small building blocks used across adapters.
 */

export type QueryValue = string | number | boolean | undefined | null;

/**
 * Build a URL with optional query parameters. Undefined/null values are
 * dropped. Does not mutate `base`.
 */
export function urlWithQuery(
  base: string,
  query: Readonly<Record<string, QueryValue>> = {},
): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Build a Request with JSON `Accept` and an optional custom headers bag.
 * Uses GET by default.
 */
export function getRequest(
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  const h = new Headers({ accept: 'application/json' });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Request(url, { method: 'GET', headers: h });
}

/**
 * Safely index into a possibly-null/unknown object.
 */
export function pick<T = unknown>(obj: unknown, key: string): T | null {
  if (obj === null || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  return v === undefined ? null : (v as T);
}

/**
 * Truthy-array check that narrows `unknown` to `unknown[]`.
 */
export function isArrayWithAny(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}
