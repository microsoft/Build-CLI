import { FetchError } from '../errors.js';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: string | null;
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function resultWithoutBody(response: Response): Promise<SafeFetchResult> {
  await response.body?.cancel();
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: null,
    finalUrl: response.url,
  };
}

export async function safeFetchJson(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs
    ?? envInt('MSEVENTS_FETCH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxBytes = options.maxBytes
    ?? envInt('MSEVENTS_MAX_RESPONSE_BYTES', DEFAULT_MAX_BYTES);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: options.headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new FetchError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new FetchError(
      `Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (response.status === 304) {
    return resultWithoutBody(response);
  }

  if (!response.ok) {
    return resultWithoutBody(response);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new FetchError(
        `Response from ${url} declares ${parsedLength} bytes (> ${maxBytes})`,
      );
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new FetchError(
      `Unexpected Content-Type from ${url}: ${contentType || '<none>'}`,
    );
  }

  if (!response.body) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: '',
      finalUrl: response.url,
    };
  }

  const reader = response.body.getReader();
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
    reader.releaseLock();
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: Buffer.concat(chunks).toString('utf-8'),
    finalUrl: response.url,
  };
}
