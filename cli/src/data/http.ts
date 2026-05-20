import { FetchError } from '../errors.js';

export interface SafeFetchOptions {
  /** Total network timeout — applies to both header receipt and body completion. */
  timeoutMs?: number;
  /** Maximum response body size in bytes. */
  maxBytes?: number;
  /** Conditional-GET headers passed through. */
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  headers: Headers;
  /** UTF-8 decoded body, or null for 304 / no-body responses. */
  body: string | null;
  /** Final URL after redirects, for logging and host validation. */
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_HOST_SUFFIXES = [
  'aka.ms',
  '.microsoft.com',
  '.azurewebsites.net',
  '.azureedge.net',
];

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isAllowedHost(urlStr: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some((s) =>
    s.startsWith('.') ? hostname.endsWith(s) : hostname === s,
  );
}

export async function safeFetchJson(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  if (!isAllowedHost(url)) {
    throw new FetchError(`Host not in allow-list: ${url}`);
  }

  const timeoutMs = options.timeoutMs
    ?? envInt('MSEVENTS_FETCH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxBytes = options.maxBytes
    ?? envInt('MSEVENTS_MAX_RESPONSE_BYTES', DEFAULT_MAX_BYTES);

  const signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: options.headers,
      signal,
      redirect: 'follow',
    });
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError') {
      throw new FetchError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new FetchError(
      `Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // response.url is empty on synthetic Response objects (test mocks) and
  // sometimes on 304s. Only enforce the post-redirect host check when a URL
  // is actually present.
  if (response.url && !isAllowedHost(response.url)) {
    throw new FetchError(`Redirect chain ended at disallowed host: ${response.url}`);
  }

  if (response.status === 304) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: null,
      finalUrl: response.url,
    };
  }

  // Non-2xx (error pages, redirects we didn't follow, etc.): callers do not
  // need the body. Short-circuit to avoid buffering an unbounded HTML payload
  // we'd discard anyway, and to keep error-path latency tight.
  if (!response.ok) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: null,
      finalUrl: response.url,
    };
  }

  const lenHeader = response.headers.get('content-length');
  if (lenHeader) {
    const len = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(len) && len > maxBytes) {
      throw new FetchError(
        `Response from ${url} declares ${len} bytes (> ${maxBytes})`,
      );
    }
  }

  // At this point response.ok is guaranteed by the short-circuit above.
  const ctype = response.headers.get('content-type') ?? '';
  if (!ctype.toLowerCase().includes('application/json')) {
    throw new FetchError(
      `Unexpected Content-Type from ${url}: ${ctype || '<none>'}`,
    );
  }

  const body = response.body;
  if (!body) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: '',
      finalUrl: response.url,
    };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchError(`Response from ${url} exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: Buffer.concat(chunks).toString('utf-8'),
    finalUrl: response.url,
  };
}
