import { isOfflineMode } from '../config.js';
import { getCacheStatus } from '../data/cache.js';
import { formatStatus } from '../output/format.js';

export async function status(opts: { json?: boolean }): Promise<void> {
  const statuses = await getCacheStatus();
  console.log(formatStatus(statuses, opts.json ?? false, isOfflineMode()));
}
