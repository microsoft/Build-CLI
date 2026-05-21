import { describe, expect, it } from 'vitest';
import type { Session } from '../src/contracts.js';
import { isCacheMeta, isRawSession, isSessionArray } from '../src/data/validate.js';

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

describe('isSessionArray', () => {
  it('requires complete string-valued Session entries', () => {
    expect(isSessionArray([completeSession()])).toBe(true);
    expect(isSessionArray([{ sessionCode: 'BRK101', event: 'build-2026' }])).toBe(false);
    expect(isSessionArray([completeSession({ title: 42 as unknown as string })])).toBe(false);
    expect(isSessionArray({})).toBe(false);
  });
});
