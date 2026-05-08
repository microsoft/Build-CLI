import type { EventConfig } from './contracts.js';

export const KNOWN_EVENTS: EventConfig[] = [
  {
    id: 'build-2025',
    name: 'Microsoft Build 2025',
    endpoint: 'https://aka.ms/build2025-session-info',
  },
  {
    id: 'ignite-2025',
    name: 'Microsoft Ignite 2025',
    endpoint: 'https://aka.ms/ignite2025-session-info',
  },
  {
    id: 'build-2026',
    name: 'Microsoft Build 2026',
    endpoint: 'https://aka.ms/build2026-session-info',
  },
];

export const DEFAULT_LIMIT = 10;
