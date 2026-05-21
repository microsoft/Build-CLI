import { describe, expect, it } from 'vitest';
import type { Session } from '../src/contracts.js';
import {
  coerceSessionArray,
  isCacheMeta,
  isRawSession,
  sanitizeSession,
} from '../src/data/validate.js';

function completeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionCode: 'BRK101',
    title: 'Title',
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
    event: 'build-2026',
    ...overrides,
  };
}

describe('isRawSession', () => {
  it('accepts objects and rejects arrays/null/primitives', () => {
    expect(isRawSession({ sessionCode: 'BRK101' })).toBe(true);
    expect(isRawSession([])).toBe(false);
    expect(isRawSession(null)).toBe(false);
    expect(isRawSession('x')).toBe(false);
  });
});

describe('isCacheMeta', () => {
  it('accepts valid cache metadata shapes', () => {
    expect(isCacheMeta({
      eventId: 'build-2026',
      fetchedAt: '2026-05-07T02:00:00.000Z',
      checkedAt: '2026-05-07T02:00:00.000Z',
      nextCheckAt: '2026-05-07T04:00:00.000Z',
      sessionCount: 1,
      etag: '"abc"',
      lastModified: 'Thu, 07 May 2026 02:00:00 GMT',
      lastCheckStatus: 'updated',
      consecutiveFailures: 0,
    })).toBe(true);
  });

  it('rejects malformed metadata', () => {
    expect(isCacheMeta({})).toBe(false);
    expect(isCacheMeta({ eventId: 'x', fetchedAt: '', sessionCount: '1' })).toBe(false);
    expect(isCacheMeta({ eventId: 'x', fetchedAt: '', sessionCount: 1, lastCheckStatus: 'weird' })).toBe(false);
  });
});

describe('sanitizeSession', () => {
  it('fills missing fields and strips unsafe control sequences', () => {
    expect(sanitizeSession({
      sessionCode: 'BRK101',
      title: '\x1B[31mTitle\x1B[0m',
    }, 'build-2026')).toMatchObject({
      sessionCode: 'BRK101',
      title: 'Title',
      description: '',
      event: 'build-2026',
    });
  });
});

describe('coerceSessionArray', () => {
  it('accepts partial session-shaped cache entries', () => {
    const sessions = coerceSessionArray([
      { sessionCode: 'BRK101', title: 'Cached' },
    ], 'build-2026');

    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({
      sessionCode: 'BRK101',
      title: 'Cached',
      description: '',
      event: 'build-2026',
    });
  });

  it('drops invalid entries instead of requiring an exact cache schema', () => {
    const sessions = coerceSessionArray([
      completeSession(),
      { sessionCode: '../../etc/passwd', title: 'Invalid' },
      { sessionCode: 'BRK102', title: 42 },
    ], 'build-2026');

    expect(sessions).toHaveLength(2);
    expect(sessions!.map((session) => session.sessionCode)).toEqual(['BRK101', 'BRK102']);
    expect(sessions![1]!.title).toBe('');
  });

  it('rejects non-array cache payloads', () => {
    expect(coerceSessionArray({}, 'build-2026')).toBeNull();
  });
});
