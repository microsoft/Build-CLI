import type { CacheMeta, RawSession, Session } from '../contracts.js';

const CACHE_STATUSES = new Set(['updated', 'not-modified', 'failed']);
const SESSION_STRING_FIELDS: Array<keyof Session> = [
  'sessionCode',
  'title',
  'description',
  'speakers',
  'timeSlot',
  'startDateTime',
  'endDateTime',
  'location',
  'level',
  'type',
  'topic',
  'solutionArea',
  'product',
  'languages',
  'tags',
  'relatedSessionCodes',
  'slideDeck',
  'onDemand',
  'event',
];

export function isRawSession(value: unknown): value is RawSession {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCacheMeta(value: unknown): value is CacheMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const meta = value as Partial<CacheMeta>;
  if (typeof meta.eventId !== 'string') return false;
  if (typeof meta.fetchedAt !== 'string') return false;
  if (typeof meta.sessionCount !== 'number' || !Number.isFinite(meta.sessionCount)) {
    return false;
  }
  if (meta.checkedAt !== undefined && typeof meta.checkedAt !== 'string') return false;
  if (meta.nextCheckAt !== undefined && typeof meta.nextCheckAt !== 'string') return false;
  if (meta.etag !== undefined && typeof meta.etag !== 'string') return false;
  if (meta.lastModified !== undefined && typeof meta.lastModified !== 'string') return false;
  if (
    meta.lastCheckStatus !== undefined
    && !CACHE_STATUSES.has(meta.lastCheckStatus)
  ) {
    return false;
  }
  if (
    meta.consecutiveFailures !== undefined
    && (typeof meta.consecutiveFailures !== 'number'
      || !Number.isFinite(meta.consecutiveFailures))
  ) {
    return false;
  }
  return true;
}

export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Partial<Session>;
  return SESSION_STRING_FIELDS.every((field) => typeof session[field] === 'string');
}

export function isSessionArray(value: unknown): value is Session[] {
  return Array.isArray(value) && value.every(isSession);
}
