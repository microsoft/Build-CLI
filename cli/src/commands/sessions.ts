import { buildIndex, searchSessions, type SearchOptions } from '../search/index.js';
import { formatSearchResults } from '../output/format.js';
import { ensureCache } from './common.js';

export async function sessions(opts: SearchOptions & { json?: boolean }): Promise<void> {
  const all = await ensureCache();
  buildIndex(all);

  const results = searchSessions(opts);
  console.log(formatSearchResults(results, opts.json ?? false));
}
