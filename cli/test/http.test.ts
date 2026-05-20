import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeFetchJson, isAllowedHost } from '../src/data/http.js';
import { FetchError } from '../src/errors.js';

describe('isAllowedHost', () => {
  it('accepts aka.ms', () => {
    expect(isAllowedHost('https://aka.ms/build2026-session-info')).toBe(true);
  });
  it('accepts learn.microsoft.com (suffix match)', () => {
    expect(isAllowedHost('https://learn.microsoft.com/api/mcp')).toBe(true);
  });
  it('accepts azurewebsites.net targets (redirect destination)', () => {
    expect(isAllowedHost('https://x.azurewebsites.net/y')).toBe(true);
  });
  it('rejects look-alike domains', () => {
    expect(isAllowedHost('https://microsoft.com.evil/x')).toBe(false);
    expect(isAllowedHost('https://akams.com/x')).toBe(false);
    expect(isAllowedHost('https://evil.example/x')).toBe(false);
  });
  it('rejects garbage URLs', () => {
    expect(isAllowedHost('not a url')).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });
});

describe('safeFetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects disallowed input host immediately, without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchJson('https://evil.example/x'))
      .rejects.toThrow(/Host not in allow-list/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts after timeoutMs and surfaces FetchError', async () => {
    vi.stubGlobal('fetch', (_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'TimeoutError';
          reject(e);
        });
      }),
    );
    await expect(
      safeFetchJson('https://aka.ms/x', { timeoutMs: 25 }),
    ).rejects.toBeInstanceOf(FetchError);
  });

  it('rejects when Content-Length exceeds maxBytes (no body fetched)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '999999999' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      safeFetchJson('https://aka.ms/x', { maxBytes: 1024 }),
    ).rejects.toThrow(/declares 999999999 bytes/);
  });

  it('rejects when streamed body exceeds maxBytes (no Content-Length)', async () => {
    const chunk = new Uint8Array(2048);
    const stream = new ReadableStream({
      start(c) { c.enqueue(chunk); c.enqueue(chunk); c.close(); },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(
      safeFetchJson('https://aka.ms/x', { maxBytes: 1024 }),
    ).rejects.toThrow(/exceeded 1024 bytes/);
  });

  it('rejects non-JSON content type on a 200 response', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    await expect(
      safeFetchJson('https://aka.ms/x'),
    ).rejects.toThrow(/Content-Type/);
  });

  it('rejects when redirect lands on a disallowed host', async () => {
    vi.stubGlobal('fetch', async () => {
      const res = new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      Object.defineProperty(res, 'url', { value: 'https://evil.example/y' });
      return res;
    });
    await expect(
      safeFetchJson('https://aka.ms/x'),
    ).rejects.toThrow(/disallowed host/);
  });

  it('returns 304 without a body and with null body field', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 304 }));
    const r = await safeFetchJson('https://aka.ms/x');
    expect(r.status).toBe(304);
    expect(r.body).toBeNull();
  });

  it('returns full body on the happy path', async () => {
    vi.stubGlobal('fetch', async () => new Response('[{"a":1}]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const r = await safeFetchJson('https://aka.ms/x');
    expect(r.status).toBe(200);
    expect(r.body).toBe('[{"a":1}]');
  });

  it('passes conditional-GET headers through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);
    await safeFetchJson('https://aka.ms/x', {
      headers: { 'If-None-Match': '"abc"', 'If-Modified-Since': 'Thu, 07 May 2026 02:00:00 GMT' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'If-None-Match': '"abc"',
      'If-Modified-Since': 'Thu, 07 May 2026 02:00:00 GMT',
    });
  });
});
