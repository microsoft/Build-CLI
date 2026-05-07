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

export async function ensureCache(): Promise<Session[]> {
  let missingCacheHeaderPrinted = false;
  const availableSessions: Session[] = [];

  for (const event of KNOWN_EVENTS) {
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
    : getAllCachedSessions();
}
