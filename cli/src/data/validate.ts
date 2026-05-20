import type { CacheMeta, RawSession, Session } from '../contracts.js';

export function isRawSession(v: unknown): v is RawSession {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isCacheMeta(v: unknown): v is CacheMeta {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Partial<CacheMeta>;
  if (typeof m.eventId !== 'string') return false;
  if (typeof m.fetchedAt !== 'string') return false;
  if (typeof m.sessionCount !== 'number' || !Number.isFinite(m.sessionCount)) return false;
  if (m.checkedAt !== undefined && typeof m.checkedAt !== 'string') return false;
  if (m.nextCheckAt !== undefined && typeof m.nextCheckAt !== 'string') return false;
  if (m.etag !== undefined && typeof m.etag !== 'string') return false;
  if (m.lastModified !== undefined && typeof m.lastModified !== 'string') return false;
  if (m.consecutiveFailures !== undefined && typeof m.consecutiveFailures !== 'number') return false;
  if (m.lastCheckStatus !== undefined
      && !['updated', 'not-modified', 'failed'].includes(m.lastCheckStatus)) return false;
  return true;
}

export function isSessionArray(v: unknown): v is Session[] {
  if (!Array.isArray(v)) return false;
  return v.every((s) =>
    typeof s === 'object' && s !== null
    && typeof (s as Partial<Session>).sessionCode === 'string'
    && typeof (s as Partial<Session>).event === 'string',
  );
}
