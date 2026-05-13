import { buildIndex, searchSessions, type SearchOptions } from '../search/index.js';
import { formatSearchResults } from '../output/format.js';
import { ensureCache, validateEventId } from './common.js';

export async function sessions(opts: SearchOptions & { json?: boolean }): Promise<void> {
  if (opts.event && !validateEventId(opts.event)) return;
  const all = await ensureCache(opts.event);
  buildIndex(all);

  const results = searchSessions(opts);
  console.log(formatSearchResults(results, opts.json ?? false));
}
