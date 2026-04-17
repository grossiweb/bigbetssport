/**
 * Small shared utilities used by the scraper implementations.
 */

const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/125.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
];

export function rotateUserAgent(): string {
  const idx = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[idx] ?? USER_AGENTS[0] ?? 'Mozilla/5.0';
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const span = Math.max(0, maxMs - minMs);
  return delay(minMs + Math.floor(Math.random() * span));
}

export interface FetchOptions {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly rotateUa?: boolean;
}

/**
 * Thin `fetch` wrapper with a default timeout and optional UA rotation.
 * Throws on non-2xx so caller code doesn't need to check `.ok`.
 */
export async function httpGet(url: string, opts: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  const headers: Record<string, string> = {
    accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    ...(opts.headers ?? {}),
  };
  if (opts.rotateUa !== false) headers['user-agent'] = rotateUserAgent();

  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} on ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await httpGet(url, { ...opts, headers: { accept: 'text/html', ...(opts.headers ?? {}) } });
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await httpGet(url, opts);
  return (await res.json()) as T;
}
