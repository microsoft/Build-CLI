import { buildIndex, findSession } from '../search/index.js';
import { formatSessionDetail } from '../output/format.js';
import { ensureCache, validateEventId } from './common.js';

export async function session(
  code: string,
  opts: { event?: string; json?: boolean },
): Promise<void> {
  if (opts.event && !validateEventId(opts.event)) return;
  const all = await ensureCache(opts.event);
  buildIndex(all);

  const matches = findSession(code, opts.event);
  console.log(formatSessionDetail(matches, opts.json ?? false));
}
