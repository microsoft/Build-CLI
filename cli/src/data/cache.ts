import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import envPaths from 'env-paths';
import type { Session, CacheMeta, EventConfig, CacheCheckStatus } from '../contracts.js';
import { KNOWN_EVENTS } from '../config.js';
import { FetchError } from '../errors.js';
import { normalizeCatalog } from './normalize.js';
import { safeFetchJson, type SafeFetchResult } from './http.js';

const paths = envPaths('msevents', { suffix: '' });
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const ACTIVE_REVALIDATION_INTERVAL_MS = 20 * MINUTE_MS;
const FAILURE_REVALIDATION_INTERVAL_MS = 15 * MINUTE_MS;
const MAX_FAILURE_REVALIDATION_INTERVAL_MS = 2 * HOUR_MS;
const JITTER_RATIO = 0.2;

export interface FetchAndCacheOptions {
  force?: boolean;
  log?: (message: string) => void;
  cachedMeta?: CacheMeta | null;
  cachedSessions?: Session[];
}

function cacheDir(): string {
  return process.env.MSEVENTS_CACHE_DIR ?? paths.cache;
}

function sessionsPath(eventId: string): string {
  return join(cacheDir(), `${eventId}-sessions.json`);
}

function metaPath(eventId: string): string {
  return join(cacheDir(), `${eventId}-meta.json`);
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function withJitter(intervalMs: number): number {
  const jitter = intervalMs * JITTER_RATIO;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(MINUTE_MS, Math.round(intervalMs + offset));
}

function formatSessionCount(count: number): string {
  return `${count} session${count === 1 ? '' : 's'}`;
}

function formatStatusLine(status: number, statusText: string): string {
  return [status, statusText].filter(Boolean).join(' ');
}

function intervalForStableCatalog(meta: CacheMeta, now: Date): number {
  const lastModified = parseTime(meta.lastModified);
  if (!lastModified) return ACTIVE_REVALIDATION_INTERVAL_MS;

  const age = now.getTime() - lastModified;
  if (age >= 30 * DAY_MS) return DAY_MS;
  if (age >= 7 * DAY_MS) return 6 * HOUR_MS;
  if (age >= DAY_MS) return 2 * HOUR_MS;
  return ACTIVE_REVALIDATION_INTERVAL_MS;
}

function nextCheckAt(
  meta: CacheMeta,
  status: CacheCheckStatus,
  now: Date,
): string {
  let interval: number;
  if (status === 'failed') {
    const failures = Math.max(meta.consecutiveFailures ?? 1, 1);
    interval = Math.min(
      FAILURE_REVALIDATION_INTERVAL_MS * (2 ** (failures - 1)),
      MAX_FAILURE_REVALIDATION_INTERVAL_MS,
    );
  } else {
    interval = intervalForStableCatalog(meta, now);
  }

  return new Date(now.getTime() + withJitter(interval)).toISOString();
}

export function isCacheCheckDue(meta: CacheMeta | null, now: Date = new Date()): boolean {
  if (!meta) return true;

  const nextCheck = parseTime(meta.nextCheckAt);
  if (nextCheck !== null) return now.getTime() >= nextCheck;

  const lastCheck = parseTime(meta.checkedAt ?? meta.fetchedAt);
  if (lastCheck === null) return true;
  return now.getTime() - lastCheck >= ACTIVE_REVALIDATION_INTERVAL_MS;
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function writeMeta(eventId: string, meta: CacheMeta): Promise<void> {
  await ensureCacheDir();
  await writeAtomic(metaPath(eventId), JSON.stringify(meta, null, 2));
}

async function cachedSessionsTimestamp(eventId: string, fallback: Date): Promise<string> {
  try {
    const stats = await stat(sessionsPath(eventId));
    return stats.mtime.toISOString();
  } catch {
    return fallback.toISOString();
  }
}

export async function readMeta(eventId: string): Promise<CacheMeta | null> {
  const path = metaPath(eventId);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(await readFile(path, 'utf-8')) as CacheMeta;
    return data;
  } catch {
    return null;
  }
}

export async function readSessions(eventId: string): Promise<Session[]> {
  const path = sessionsPath(eventId);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Session[];
  } catch {
    return [];
  }
}

function hasCachedSessions(eventId: string): boolean {
  return existsSync(sessionsPath(eventId));
}

async function recordFetchFailure(eventId: string): Promise<void> {
  await recordFailedCheck(eventId);
}

export async function fetchAndCache(
  event: EventConfig,
  options: FetchAndCacheOptions = {},
): Promise<Session[]> {
  await ensureCacheDir();

  const { force = false, log, cachedSessions } = options;
  const existingMeta = options.cachedMeta === undefined
    ? await readMeta(event.id)
    : options.cachedMeta;
  const hasExistingSessions = cachedSessions === undefined
    ? hasCachedSessions(event.id)
    : cachedSessions.length > 0;
  const cachedSessionCount = cachedSessions?.length ?? existingMeta?.sessionCount;
  const headers: Record<string, string> = {};
  const canRevalidate = !force && existingMeta !== null && hasExistingSessions;

  log?.(hasExistingSessions
    ? `  Local cache: found ${
      cachedSessionCount === undefined
        ? 'existing sessions'
        : formatSessionCount(cachedSessionCount)
    }.\n`
    : '  Local cache: missing.\n');

  // Conditional GET if we have prior data and not forcing
  if (canRevalidate) {
    if (existingMeta.etag) headers['If-None-Match'] = existingMeta.etag;
    if (existingMeta.lastModified) headers['If-Modified-Since'] = existingMeta.lastModified;
  }

  if (force) {
    log?.('  Remote check: full GET (--force).\n');
  } else if (canRevalidate) {
    log?.('  Remote check: conditional GET.\n');
  } else {
    log?.('  Remote check: GET.\n');
  }

  let result: SafeFetchResult;
  try {
    result = await safeFetchJson(event.endpoint, { headers });
  } catch (err) {
    await recordFetchFailure(event.id);
    if (err instanceof FetchError) throw err;
    throw new FetchError(
      `Failed to reach ${event.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 304 Not Modified — cache is still fresh
  if (result.status === 304) {
    if (!canRevalidate || existingMeta === null) {
      await recordFetchFailure(event.id);
      throw new FetchError(
        `${event.endpoint} returned 304 without a usable local cache`,
        result.status,
      );
    }

    const existingSessions = cachedSessions ?? await readSessions(event.id);
    if (existingSessions.length === 0) {
      await recordFetchFailure(event.id);
      throw new FetchError(
        `${event.endpoint} returned 304 without a usable local cache`,
        result.status,
      );
    }

    const now = new Date();
    const checkedMeta: CacheMeta = {
      ...existingMeta,
      checkedAt: now.toISOString(),
      lastCheckStatus: 'not-modified',
      consecutiveFailures: 0,
    };
    checkedMeta.nextCheckAt = nextCheckAt(checkedMeta, 'not-modified', now);
    await writeMeta(event.id, checkedMeta);
    log?.('  Remote catalog: not modified (304 Not Modified).\n');
    log?.('  JSON download: no.\n');
    log?.(`  Local cache: up to date; using ${formatSessionCount(existingSessions.length)}.\n`);
    return existingSessions;
  }

  if (result.status < 200 || result.status >= 300) {
    log?.(`  Remote catalog: failed (${formatStatusLine(result.status, result.statusText)}).\n`);
    await recordFetchFailure(event.id);
    throw new FetchError(
      `${event.endpoint} returned ${result.status}`,
      result.status,
    );
  }

  log?.(`  Remote catalog: downloaded (${formatStatusLine(result.status, result.statusText)}).\n`);
  log?.('  JSON download: yes.\n');

  let raw: unknown;
  try {
    raw = JSON.parse(result.body ?? '');
  } catch (err) {
    await recordFetchFailure(event.id);
    throw new FetchError(
      `${event.endpoint} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(raw)) {
    await recordFetchFailure(event.id);
    throw new FetchError(`${event.endpoint} returned an unexpected catalog shape`);
  }

  const sessions = normalizeCatalog(raw, event.id);
  if (sessions.length === 0) {
    await recordFetchFailure(event.id);
    throw new FetchError(`${event.endpoint} returned a catalog with no valid sessions`);
  }
  const now = new Date();

  const metaBase: CacheMeta = {
    eventId: event.id,
    fetchedAt: now.toISOString(),
    checkedAt: now.toISOString(),
    sessionCount: sessions.length,
    etag: result.headers.get('etag') ?? undefined,
    lastModified: result.headers.get('last-modified') ?? undefined,
    lastCheckStatus: 'updated',
    consecutiveFailures: 0,
  };
  const meta: CacheMeta = {
    ...metaBase,
    nextCheckAt: nextCheckAt(metaBase, 'updated', now),
  };

  await writeAtomic(sessionsPath(event.id), JSON.stringify(sessions));
  await writeMeta(event.id, meta);
  log?.(`  Local cache: ${hasExistingSessions ? 'updated' : 'created'} with ${formatSessionCount(sessions.length)}.\n`);

  return sessions;
}

export async function recordFailedCheck(eventId: string): Promise<void> {
  const existingMeta = await readMeta(eventId);
  const existingSessions = existingMeta ? [] : await readSessions(eventId);
  if (!existingMeta && existingSessions.length === 0) return;

  const now = new Date();
  const checkedMeta: CacheMeta = existingMeta
    ? {
        ...existingMeta,
        checkedAt: now.toISOString(),
        lastCheckStatus: 'failed',
        consecutiveFailures: (existingMeta.consecutiveFailures ?? 0) + 1,
      }
    : {
        eventId,
        fetchedAt: await cachedSessionsTimestamp(eventId, now),
        checkedAt: now.toISOString(),
        sessionCount: existingSessions.length,
        lastCheckStatus: 'failed',
        consecutiveFailures: 1,
      };
  checkedMeta.nextCheckAt = nextCheckAt(checkedMeta, 'failed', now);
  await writeMeta(eventId, checkedMeta);
}

export async function getAllCachedSessions(): Promise<Session[]> {
  await ensureCacheDir();
  const all: Session[] = [];
  for (const event of KNOWN_EVENTS) {
    const sessions = await readSessions(event.id);
    all.push(...sessions);
  }
  return all;
}

export async function getCacheStatus(): Promise<Array<{ eventId: string; meta: CacheMeta | null }>> {
  const statuses = [];
  for (const event of KNOWN_EVENTS) {
    statuses.push({ eventId: event.id, meta: await readMeta(event.id) });
  }
  return statuses;
}
