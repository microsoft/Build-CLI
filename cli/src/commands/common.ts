import { KNOWN_EVENTS } from '../config.js';
import {
  fetchAndCache,
  getAllCachedSessions,
  isCacheCheckDue,
  readMeta,
  readSessions,
} from '../data/cache.js';
import type { Session } from '../contracts.js';
import { FetchError } from '../errors.js';

export function validateEventId(eventId: string): boolean {
  if (KNOWN_EVENTS.some((e) => e.id === eventId)) return true;
  console.error(`Unknown event: ${eventId}`);
  console.error(`Known events: ${KNOWN_EVENTS.map((e) => e.id).join(', ')}`);
  process.exitCode = 1;
  return false;
}

const MAX_LIMIT = 200;

export function validateLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    console.error(`--limit must be a positive integer (got: "${raw}")`);
    process.exitCode = 1;
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed > MAX_LIMIT) {
    process.stderr.write(`--limit ${parsed} exceeds maximum (${MAX_LIMIT}); clamping.\n`);
    return MAX_LIMIT;
  }

  return parsed;
}

export async function ensureCache(eventFilter?: string): Promise<Session[]> {
  let missingCacheHeaderPrinted = false;
  const availableSessions: Session[] = [];
  const events = eventFilter
    ? KNOWN_EVENTS.filter((event) => event.id === eventFilter)
    : KNOWN_EVENTS;

  for (const event of events) {
    const cachedSessions = await readSessions(event.id);
    const meta = await readMeta(event.id);
    const isMissingCache = cachedSessions.length === 0;

    if (!isMissingCache && !isCacheCheckDue(meta)) {
      availableSessions.push(...cachedSessions);
      continue;
    }

    try {
      if (isMissingCache) {
        if (!missingCacheHeaderPrinted) {
          process.stderr.write('Fetching missing session caches...\n');
          missingCacheHeaderPrinted = true;
        }
        process.stderr.write(`  ${event.name}...`);
      }

      const fetched = await fetchAndCache(event, {
        cachedMeta: meta,
        cachedSessions,
      });
      availableSessions.push(...fetched);
      if (isMissingCache) {
        process.stderr.write(` ${fetched.length} sessions.\n`);
      }
    } catch (err) {
      if (!(err instanceof FetchError)) {
        throw err;
      }

      if (isMissingCache) {
        process.stderr.write(` unavailable: ${err.message}\n`);
      } else {
        availableSessions.push(...cachedSessions);
        process.stderr.write(`Could not refresh ${event.name}; using cached sessions.\n`);
      }
    }
  }

  return availableSessions.length > 0
    ? availableSessions
    : eventFilter
      ? readSessions(eventFilter)
      : getAllCachedSessions();
}
