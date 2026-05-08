import { KNOWN_EVENTS } from '../config.js';
import { fetchAndCache } from '../data/cache.js';
import { FetchError } from '../errors.js';
import { validateEventId } from './common.js';

export async function refresh(eventFilter?: string, force: boolean = false): Promise<void> {
  if (eventFilter && !validateEventId(eventFilter)) return;

  const events = eventFilter
    ? KNOWN_EVENTS.filter((e) => e.id === eventFilter)
    : KNOWN_EVENTS;

  for (const event of events) {
    try {
      process.stderr.write(`Checking ${event.name}...\n`);
      await fetchAndCache(event, {
        force,
        log: (message) => {
          process.stderr.write(message);
        },
      });
    } catch (err) {
      if (err instanceof FetchError) {
        process.stderr.write(` failed: ${err.message}\n`);
      } else {
        throw err;
      }
    }
  }
}
