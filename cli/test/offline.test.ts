import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isOfflineMode } from '../src/config.js';
import { ensureCache } from '../src/commands/common.js';
import { refresh } from '../src/commands/refresh.js';
import { formatStatus } from '../src/output/format.js';
import type { CacheMeta, Session } from '../src/contracts.js';

function session(event: string, sessionCode: string): Session {
  return {
    sessionCode,
    title: `${event} ${sessionCode}`,
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

const dueMeta: CacheMeta = {
  eventId: 'build-2025',
  fetchedAt: '2020-01-01T00:00:00.000Z',
  checkedAt: '2020-01-01T00:00:00.000Z',
  nextCheckAt: '2020-01-01T00:20:00.000Z',
  sessionCount: 1,
};

function stderrOutput(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([chunk]) => String(chunk)).join('');
}

describe('isOfflineMode', () => {
  afterEach(() => {
    delete process.env.MSEVENTS_OFFLINE;
  });

  it.each(['1', 'true', 'TRUE', ' 1 '])('is on for %j', (value) => {
    process.env.MSEVENTS_OFFLINE = value;
    expect(isOfflineMode()).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'yes'])('is off for %j', (value) => {
    if (value === undefined) delete process.env.MSEVENTS_OFFLINE;
    else process.env.MSEVENTS_OFFLINE = value;
    expect(isOfflineMode()).toBe(false);
  });
});

describe('offline mode (MSEVENTS_OFFLINE)', () => {
  let cacheDir: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'msevents-offline-test-'));
    process.env.MSEVENTS_CACHE_DIR = cacheDir;
    process.env.MSEVENTS_OFFLINE = '1';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(join(cacheDir, 'build-2025-sessions.json'), JSON.stringify([session('build-2025', 'BRK100')]));
    await writeFile(join(cacheDir, 'build-2025-meta.json'), JSON.stringify(dueMeta));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MSEVENTS_CACHE_DIR;
    delete process.env.MSEVENTS_OFFLINE;
    process.exitCode = undefined;
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('reads cached sessions without revalidating a cache that is due', async () => {
    const sessions = await ensureCache('build-2025');

    expect(sessions.map((s) => s.sessionCode)).toEqual(['BRK100']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderrOutput()).toBe('');
    expect(JSON.parse(await readFile(join(cacheDir, 'build-2025-meta.json'), 'utf-8'))).toEqual(dueMeta);
  });

  it('skips events with no cache, notes them once, and writes nothing', async () => {
    const sessions = await ensureCache();

    expect(sessions.map((s) => s.sessionCode)).toEqual(['BRK100']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderrOutput()).toBe(
      'Offline (MSEVENTS_OFFLINE): no cached sessions for Microsoft Ignite 2025, Microsoft Build 2026.\n',
    );
    expect((await readdir(cacheDir)).sort()).toEqual(['build-2025-meta.json', 'build-2025-sessions.json']);
  });

  it('returns no sessions for an uncached event', async () => {
    expect(await ensureCache('ignite-2025')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderrOutput()).toContain('no cached sessions for Microsoft Ignite 2025');
  });

  it('makes refresh fail without fetching', async () => {
    await refresh('build-2025', true);

    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain('MSEVENTS_OFFLINE is set');
  });
});

describe('formatStatus in offline mode', () => {
  const statuses = [
    { eventId: 'build-2025', meta: { ...dueMeta, lastCheckStatus: 'updated' as const } },
    { eventId: 'ignite-2025', meta: null },
  ];

  it('adds an offline line to text output', () => {
    const lines = formatStatus(statuses, false, true).split('\n');
    expect(lines[0]).toBe("Offline (MSEVENTS_OFFLINE): cached data is read-only and won't be updated.");
    expect(lines.slice(1)).toEqual(formatStatus(statuses, false).split('\n'));
  });

  it('marks every JSON entry as offline', () => {
    expect(JSON.parse(formatStatus(statuses, true, true))).toEqual(
      statuses.map((s) => ({ ...s, offline: true })),
    );
    expect(JSON.parse(formatStatus(statuses, true))).toEqual(statuses);
  });
});
