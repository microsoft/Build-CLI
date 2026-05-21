import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchError } from '../src/errors.js';
import { safeFetchJson } from '../src/data/http.js';

describe('safeFetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MSEVENTS_FETCH_TIMEOUT_MS;
    delete process.env.MSEVENTS_MAX_RESPONSE_BYTES;
  });

  it('passes conditional request headers through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    await safeFetchJson('https://aka.ms/build2026-session-info', {
      headers: {
        'If-None-Match': '"abc"',
        'If-Modified-Since': 'Thu, 07 May 2026 02:00:00 GMT',
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'If-None-Match': '"abc"',
      'If-Modified-Since': 'Thu, 07 May 2026 02:00:00 GMT',
    });
  });

  it('returns 304 without requiring content-type or body', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 304 }));

    const result = await safeFetchJson('https://aka.ms/build2026-session-info');

    expect(result.status).toBe(304);
    expect(result.body).toBeNull();
  });

  it('rejects non-json 2xx responses', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    await expect(safeFetchJson('https://aka.ms/build2026-session-info'))
      .rejects.toThrow(/Unexpected Content-Type/);
  });

  it('returns non-2xx without reading the response body and cancels it', async () => {
    let canceled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<html>' + 'x'.repeat(10_000) + '</html>'));
      },
      cancel() {
        canceled = true;
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'content-type': 'text/html' },
    }));

    const result = await safeFetchJson('https://aka.ms/build2026-session-info');

    expect(result.status).toBe(503);
    expect(result.statusText).toBe('Service Unavailable');
    expect(result.body).toBeNull();
    expect(canceled).toBe(true);
  });

  it('rejects declared oversized responses', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '999999',
      },
    }));

    await expect(safeFetchJson('https://aka.ms/build2026-session-info', { maxBytes: 10 }))
      .rejects.toThrow(/declares 999999 bytes/);
  });

  it('rejects streamed responses that exceed the byte cap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32));
        controller.enqueue(new Uint8Array(32));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(safeFetchJson('https://aka.ms/build2026-session-info', { maxBytes: 40 }))
      .rejects.toThrow(/exceeded 40 bytes/);
  });

  it('maps fetch timeouts to FetchError', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'TimeoutError';
          reject(error);
        });
      }));

    await expect(safeFetchJson('https://aka.ms/build2026-session-info', { timeoutMs: 5 }))
      .rejects.toBeInstanceOf(FetchError);
  });
});
