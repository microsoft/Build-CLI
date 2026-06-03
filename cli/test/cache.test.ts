import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureCache } from '../src/commands/common.js';
import { refresh } from '../src/commands/refresh.js';
import {
  getAllCachedSessions,
  readMeta,
} from '../src/data/cache.js';
import type { CacheMeta, RawSession, Session } from '../src/contracts.js';

const NOW = '2026-05-07T03:00:00.000Z';

function session(event: string, sessionCode: string = 'KEY01'): Session {
  return {
    sessionCode,
    title: `${event} title`,
    description: '',
    speakers: '',
    timeSlot: '',
    startDateTime: '',
    endDateTime: '',
    location: '',
    level: '',
    type: '',
    topic: '',
    solutionArea: '',
    product: '',
    languages: '',
    tags: '',
    deliveryTypes: '',
    viewingOptions: '',
    hasLiveStream: false,
    hasOnDemand: false,
    relatedSessionCodes: '',
    slideDeck: '',
    onDemand: '',
    event,
  };
}

function meta(eventId: string, overrides: Partial<CacheMeta> = {}): CacheMeta {
  return {
    eventId,
    fetchedAt: '2026-05-07T02:00:00.000Z',
    checkedAt: '2026-05-07T02:00:00.000Z',
    nextCheckAt: '2026-05-07T04:00:00.000Z',
    sessionCount: 1,
    etag: `"${eventId}"`,
    lastModified: 'Thu, 07 May 2026 02:00:00 GMT',
    lastCheckStatus: 'updated',
    consecutiveFailures: 0,
    ...overrides,
  };
}

function jsonResponse(raw: RawSession[], headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(raw), {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function stderrOutput(): string {
  return vi.mocked(process.stderr.write).mock.calls
    .map(([chunk]) => String(chunk))
    .join('');
}

describe('automatic cache revalidation', () => {
  let cacheDir: string;

  async function writeCachedEvent(
    eventId: string,
    metaOverrides: Partial<CacheMeta> = {},
    sessionCode: string = 'KEY01',
  ): Promise<void> {
    await writeFile(
      join(cacheDir, `${eventId}-sessions.json`),
      JSON.stringify([session(eventId, sessionCode)]),
    );
    await writeFile(
      join(cacheDir, `${eventId}-meta.json`),
      JSON.stringify(meta(eventId, metaOverrides), null, 2),
    );
  }

  async function writeSessionsOnly(eventId: string, sessionCode: string = 'KEY01'): Promise<void> {
    await writeFile(
      join(cacheDir, `${eventId}-sessions.json`),
      JSON.stringify([session(eventId, sessionCode)]),
    );
  }

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'msevents-cache-test-'));
    process.env.MSEVENTS_CACHE_DIR = cacheDir;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MSEVENTS_CACHE_DIR;
    delete process.env.MSEVENTS_MAX_RESPONSE_BYTES;
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('skips remote checks when all caches were checked recently', async () => {
    await writeCachedEvent('build-2025');
    await writeCachedEvent('ignite-2025');
    await writeCachedEvent('build-2026');
    const originalMeta = await readMeta('build-2026');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readMeta('build-2026')).toEqual(originalMeta);
    expect(sessions.map((s) => s.event).sort()).toEqual(['build-2025', 'build-2026', 'ignite-2025']);
  });

  it('uses conditional GET when a cached event is due for revalidation', async () => {
    const fetchedAt = '2026-05-07T01:00:00.000Z';
    await writeCachedEvent('build-2025', {
      fetchedAt,
      checkedAt: '2026-05-07T01:00:00.000Z',
      nextCheckAt: '2026-05-07T02:00:00.000Z',
      etag: '"abc"',
      lastModified: 'Thu, 07 May 2026 01:00:00 GMT',
    });
    await writeCachedEvent('ignite-2025');
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    await ensureCache();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'If-None-Match': '"abc"',
      'If-Modified-Since': 'Thu, 07 May 2026 01:00:00 GMT',
    });

    const updatedMeta = await readMeta('build-2025');
    expect(updatedMeta?.fetchedAt).toBe(fetchedAt);
    expect(updatedMeta?.checkedAt).toBe(NOW);
    expect(updatedMeta?.lastCheckStatus).toBe('not-modified');
    expect(updatedMeta?.consecutiveFailures).toBe(0);
    expect(Date.parse(updatedMeta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));
  });

  it('keeps stale cache usable and backs off when revalidation fails', async () => {
    await writeCachedEvent('build-2025', {
      checkedAt: '2026-05-07T01:00:00.000Z',
      nextCheckAt: '2026-05-07T02:00:00.000Z',
      consecutiveFailures: 1,
    });
    await writeCachedEvent('ignite-2025');
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await ensureCache();

    const sessions = await getAllCachedSessions();
    expect(sessions.some((s) => s.event === 'build-2025')).toBe(true);

    const updatedMeta = await readMeta('build-2025');
    expect(updatedMeta?.lastCheckStatus).toBe('failed');
    expect(updatedMeta?.consecutiveFailures).toBe(2);
    expect(updatedMeta?.checkedAt).toBe(NOW);
    expect(Date.parse(updatedMeta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));
  });

  it('repairs missing metadata after failed revalidation so backoff still applies', async () => {
    await writeSessionsOnly('build-2025');
    await writeCachedEvent('ignite-2025');
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await ensureCache();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const repairedMeta = await readMeta('build-2025');
    expect(repairedMeta).toMatchObject({
      eventId: 'build-2025',
      sessionCount: 1,
      lastCheckStatus: 'failed',
      consecutiveFailures: 1,
      checkedAt: NOW,
    });
    expect(Date.parse(repairedMeta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));

    fetchMock.mockClear();
    await ensureCache();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and caches missing events automatically', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        [{ sessionCode: 'BRK101', title: 'Build 2025 session' }],
        { etag: '"2025"', 'last-modified': 'Thu, 07 May 2026 02:55:00 GMT' },
      ))
      .mockResolvedValueOnce(jsonResponse(
        [{ sessionCode: 'IGN301', title: 'Ignite 2025 session' }],
        { etag: '"ign2025"', 'last-modified': 'Thu, 07 May 2026 02:55:30 GMT' },
      ))
      .mockResolvedValueOnce(jsonResponse(
        [{ sessionCode: 'BRK202', title: 'Build 2026 session' }],
        { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
      ));
    vi.stubGlobal('fetch', fetchMock);

    await ensureCache();

    const sessions = await getAllCachedSessions();
    expect(sessions.map((s) => s.sessionCode).sort()).toEqual(['BRK101', 'BRK202', 'IGN301']);

    const build2026Meta = await readMeta('build-2026');
    expect(build2026Meta?.lastCheckStatus).toBe('updated');
    expect(build2026Meta?.checkedAt).toBe(NOW);
    expect(Date.parse(build2026Meta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));

    const cachedJson = JSON.parse(
      await readFile(join(cacheDir, 'build-2026-sessions.json'), 'utf-8'),
    ) as Session[];
    expect(cachedJson[0]?.event).toBe('build-2026');
  });

  it('uses an existing scoped cache without checking other events', async () => {
    await writeCachedEvent('build-2026', {}, 'BRK202');
    const originalMeta = await readMeta('build-2026');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache('build-2026');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessions.map((s) => s.sessionCode)).toEqual(['BRK202']);
    expect(await readMeta('build-2026')).toEqual(originalMeta);
    expect(existsSync(join(cacheDir, 'build-2025-sessions.json'))).toBe(false);
    expect(existsSync(join(cacheDir, 'ignite-2025-sessions.json'))).toBe(false);
  });

  it('fetches a different scoped event without refreshing an existing scoped cache', async () => {
    await writeCachedEvent('build-2026', {}, 'BRK202');
    const originalBuild2026Meta = await readMeta('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK101', title: 'Build 2025 session' }],
      { etag: '"2025"', 'last-modified': 'Thu, 07 May 2026 02:55:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache('build-2025');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://aka.ms/build2025-session-info');
    expect(sessions.map((s) => s.sessionCode)).toEqual(['BRK101']);
    expect(await readMeta('build-2026')).toEqual(originalBuild2026Meta);
    expect(existsSync(join(cacheDir, 'ignite-2025-sessions.json'))).toBe(false);
  });

  it('reuses existing caches and fetches missing caches when loading all events', async () => {
    await writeCachedEvent('build-2026', {}, 'BRK202');
    const originalBuild2026Meta = await readMeta('build-2026');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        [{ sessionCode: 'BRK101', title: 'Build 2025 session' }],
        { etag: '"2025"', 'last-modified': 'Thu, 07 May 2026 02:55:00 GMT' },
      ))
      .mockResolvedValueOnce(jsonResponse(
        [{ sessionCode: 'IGN301', title: 'Ignite 2025 session' }],
        { etag: '"ign2025"', 'last-modified': 'Thu, 07 May 2026 02:55:30 GMT' },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://aka.ms/build2025-session-info',
      'https://aka.ms/ignite2025-session-info',
    ]);
    expect(sessions.map((s) => s.sessionCode).sort()).toEqual(['BRK101', 'BRK202', 'IGN301']);
    expect(await readMeta('build-2026')).toEqual(originalBuild2026Meta);
  });

  it('fetches only the requested event when cache loading is scoped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK202', title: 'Build 2026 session' }],
      { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache('build-2026');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://aka.ms/build2026-session-info');
    expect(sessions.map((s) => s.event)).toEqual(['build-2026']);
    expect(existsSync(join(cacheDir, 'build-2026-sessions.json'))).toBe(true);
    expect(existsSync(join(cacheDir, 'build-2025-sessions.json'))).toBe(false);
    expect(existsSync(join(cacheDir, 'ignite-2025-sessions.json'))).toBe(false);
  });

  it('does not fall back to unrelated cached events when scoped cache loading fails', async () => {
    await writeCachedEvent('build-2025');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await ensureCache('build-2026');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessions).toEqual([]);
  });

  it('reports unchanged refreshes when the remote catalog returns 304', async () => {
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026');

    expect(stderrOutput()).toContain(
      'Checking Microsoft Build 2026...\n' +
        '  Local cache: found 1 session.\n' +
        '  Remote check: conditional GET.\n' +
        '  Remote catalog: not modified (304 Not Modified).\n' +
        '  JSON download: no.\n' +
        '  Local cache: up to date; using 1 session.\n',
    );
  });

  it('reports updated refreshes when the remote catalog returns new content', async () => {
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK202', title: 'Updated Build 2026 session' }],
      { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026');

    expect(stderrOutput()).toContain(
      'Checking Microsoft Build 2026...\n' +
        '  Local cache: found 1 session.\n' +
        '  Remote check: conditional GET.\n' +
        '  Remote catalog: downloaded (200 OK).\n' +
        '  JSON download: yes.\n' +
        '  Local cache: updated with 1 session.\n',
    );
  });

  it('reports cached refreshes when there was no local cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK202', title: 'Build 2026 session' }],
      { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026');

    expect(stderrOutput()).toContain(
      'Checking Microsoft Build 2026...\n' +
        '  Local cache: missing.\n' +
        '  Remote check: GET.\n' +
        '  Remote catalog: downloaded (200 OK).\n' +
        '  JSON download: yes.\n' +
        '  Local cache: created with 1 session.\n',
    );
  });

  it('reports forced refreshes as downloaded JSON', async () => {
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK202', title: 'Build 2026 session' }],
      { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026', true);

    expect(stderrOutput()).toContain(
      'Checking Microsoft Build 2026...\n' +
        '  Local cache: found 1 session.\n' +
        '  Remote check: full GET (--force).\n' +
        '  Remote catalog: downloaded (200 OK).\n' +
        '  JSON download: yes.\n' +
        '  Local cache: updated with 1 session.\n',
    );
  });

  it('records failed explicit refreshes when a local cache exists', async () => {
    await writeCachedEvent('build-2026');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026');

    const updatedMeta = await readMeta('build-2026');
    expect(updatedMeta?.lastCheckStatus).toBe('failed');
    expect(updatedMeta?.consecutiveFailures).toBe(1);
    expect(updatedMeta?.checkedAt).toBe(NOW);
    expect(Date.parse(updatedMeta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));
    expect(stderrOutput()).toContain('failed: Failed to reach');
  });

  it('records failed checks when the remote returns 304 without usable metadata', async () => {
    await writeSessionsOnly('build-2026');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    await refresh('build-2026');

    const repairedMeta = await readMeta('build-2026');
    expect(repairedMeta?.lastCheckStatus).toBe('failed');
    expect(repairedMeta?.consecutiveFailures).toBe(1);
    expect(repairedMeta?.checkedAt).toBe(NOW);
    expect(Date.parse(repairedMeta?.nextCheckAt ?? '')).toBeGreaterThan(Date.parse(NOW));
    expect(stderrOutput()).toContain(
      'failed: https://aka.ms/build2026-session-info ' +
        'returned 304 without a usable local cache',
      );
    });

  it('writes cache files atomically without leaving temp files on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [{ sessionCode: 'BRK202', title: 'Build 2026 session' }],
      { etag: '"2026"', 'last-modified': 'Thu, 07 May 2026 02:56:00 GMT' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await ensureCache('build-2026');

    const raw = await readFile(join(cacheDir, 'build-2026-sessions.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const entries = await readdir(cacheDir);
    expect(entries.some((entry) => entry.includes('.tmp.'))).toBe(false);
  });

  it('falls back to stale cache when safe fetch rejects', async () => {
    await writeCachedEvent('build-2026', {
      checkedAt: '2026-05-07T01:00:00.000Z',
      nextCheckAt: '2026-05-07T02:00:00.000Z',
    });
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    const sessions = await ensureCache('build-2026');

    expect(sessions).toHaveLength(1);
    const updatedMeta = await readMeta('build-2026');
    expect(updatedMeta?.lastCheckStatus).toBe('failed');
  });

  it('treats oversized remote responses as fetch failures and keeps stale cache', async () => {
    await writeCachedEvent('build-2026', {
      checkedAt: '2026-05-07T01:00:00.000Z',
      nextCheckAt: '2026-05-07T02:00:00.000Z',
    });
    vi.stubGlobal('fetch', async () => new Response('[]', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '999999',
      },
    }));
    process.env.MSEVENTS_MAX_RESPONSE_BYTES = '10';

    const sessions = await ensureCache('build-2026');

    expect(sessions).toHaveLength(1);
    const updatedMeta = await readMeta('build-2026');
    expect(updatedMeta?.lastCheckStatus).toBe('failed');
  });

  it('treats catalogs with no valid sessions as fetch failures', async () => {
    await writeCachedEvent('build-2026', {
      checkedAt: '2026-05-07T01:00:00.000Z',
      nextCheckAt: '2026-05-07T02:00:00.000Z',
    });
    vi.stubGlobal('fetch', async () => jsonResponse([
      { title: 'Missing code' },
    ]));

    const sessions = await ensureCache('build-2026');

    expect(sessions).toHaveLength(1);
    const updatedMeta = await readMeta('build-2026');
    expect(updatedMeta?.lastCheckStatus).toBe('failed');
  });
});
