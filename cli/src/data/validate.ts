import type { CacheMeta, RawSession, Session } from '../contracts.js';
import { stripControlSequences } from './sanitize.js';

const CACHE_STATUSES = new Set(['updated', 'not-modified', 'failed']);
const SESSION_CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,32}$/i;

const EMPTY_SESSION: Session = {
  sessionCode: '',
  title: '',
  description: '',
  speakers: '',
  timeSlot: '',
  startDateTime: '',
  endDateTime: '',
  location: '',
  level: '',
  type: '',
  topic: '',
  solutionArea: '',
  product: '',
  languages: '',
  tags: '',
  relatedSessionCodes: '',
  slideDeck: '',
  onDemand: '',
  event: '',
};

type SessionRecord = Partial<Record<keyof Session, unknown>>;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? stripControlSequences(value).trim() : '';
}

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

export function sanitizeSession(value: SessionRecord, eventId?: string): Session {
  return {
    ...EMPTY_SESSION,
    sessionCode: cleanString(value.sessionCode),
    title: cleanString(value.title),
    description: cleanString(value.description),
    speakers: cleanString(value.speakers),
    timeSlot: cleanString(value.timeSlot),
    startDateTime: cleanString(value.startDateTime),
    endDateTime: cleanString(value.endDateTime),
    location: cleanString(value.location),
    level: cleanString(value.level),
    type: cleanString(value.type),
    topic: cleanString(value.topic),
    solutionArea: cleanString(value.solutionArea),
    product: cleanString(value.product),
    languages: cleanString(value.languages),
    tags: cleanString(value.tags),
    relatedSessionCodes: cleanString(value.relatedSessionCodes),
    slideDeck: cleanString(value.slideDeck),
    onDemand: cleanString(value.onDemand),
    event: cleanString(value.event) || eventId || '',
  };
}

export function coerceSession(value: unknown, eventId: string): Session | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const session = sanitizeSession(value as SessionRecord, eventId);
  if (!session.sessionCode || !SESSION_CODE_RE.test(session.sessionCode)) return null;
  return {
    ...session,
    event: eventId,
  };
}

export function coerceSessionArray(value: unknown, eventId: string): Session[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((session) => coerceSession(session, eventId))
    .filter((session): session is Session => session !== null);
}
