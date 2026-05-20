import { describe, it, expect } from 'vitest';
import { isCacheMeta, isSessionArray, isRawSession } from '../src/data/validate.js';

describe('isCacheMeta', () => {
  it('accepts a minimal valid meta', () => {
    expect(isCacheMeta({
      eventId: 'x',
      fetchedAt: '2026-01-01T00:00:00Z',
      sessionCount: 1,
    })).toBe(true);
  });
  it('accepts a fully-populated meta', () => {
    expect(isCacheMeta({
      eventId: 'x',
      fetchedAt: '2026-01-01T00:00:00Z',
      checkedAt: '2026-01-01T00:00:00Z',
      nextCheckAt: '2026-01-02T00:00:00Z',
      sessionCount: 1,
      etag: '"abc"',
      lastModified: 'Fri, 01 Jan 2026 00:00:00 GMT',
      lastCheckStatus: 'updated',
      consecutiveFailures: 0,
    })).toBe(true);
  });
  it('rejects missing required fields', () => {
    expect(isCacheMeta({})).toBe(false);
    expect(isCacheMeta({ eventId: 'x' })).toBe(false);
  });
  it('rejects wrong types', () => {
    expect(isCacheMeta({ eventId: 1, fetchedAt: '', sessionCount: 0 })).toBe(false);
    expect(isCacheMeta({ eventId: 'x', fetchedAt: '', sessionCount: 'one' })).toBe(false);
  });
  it('rejects unknown lastCheckStatus', () => {
    expect(isCacheMeta({
      eventId: 'x', fetchedAt: '', sessionCount: 0, lastCheckStatus: 'mystery',
    })).toBe(false);
  });
  it('rejects null and non-objects', () => {
    expect(isCacheMeta(null)).toBe(false);
    expect(isCacheMeta(42)).toBe(false);
    expect(isCacheMeta('json')).toBe(false);
  });
});

describe('isSessionArray', () => {
  it('accepts an array of session-shaped objects', () => {
    expect(isSessionArray([{ sessionCode: 'A', event: 'build-2026' }])).toBe(true);
  });
  it('accepts an empty array', () => {
    expect(isSessionArray([])).toBe(true);
  });
  it('rejects an array with malformed entries', () => {
    expect(isSessionArray([{ sessionCode: 'A' }])).toBe(false);
    expect(isSessionArray([null])).toBe(false);
  });
  it('rejects non-arrays', () => {
    expect(isSessionArray({})).toBe(false);
    expect(isSessionArray('x')).toBe(false);
  });
});

describe('isRawSession', () => {
  it('accepts plain objects', () => {
    expect(isRawSession({})).toBe(true);
    expect(isRawSession({ sessionCode: 'A' })).toBe(true);
  });
  it('rejects arrays, null, primitives', () => {
    expect(isRawSession([])).toBe(false);
    expect(isRawSession(null)).toBe(false);
    expect(isRawSession('x')).toBe(false);
  });
});
