import type { EventConfig } from './contracts.js';

export const KNOWN_EVENTS: EventConfig[] = [
  {
    id: 'build-2026',
    name: 'Microsoft Build 2026',
    endpoint: 'https://aka.ms/build2026-session-info',
  },
  {
    id: 'ignite-2026',
    name: 'Microsoft Ignite 2026',
    endpoint: 'https://aka.ms/ignite2026-session-info',
  },
];

export const DEFAULT_LIMIT = 10;

export const OFFLINE_ENV_VAR = 'MSEVENTS_OFFLINE';

/**
 * Offline mode (MSEVENTS_OFFLINE=1 or true) reads cached sessions only: it never
 * fetches catalogs or writes to the cache, so the cache folder can be read-only.
 */
export function isOfflineMode(): boolean {
  const value = process.env[OFFLINE_ENV_VAR]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}
