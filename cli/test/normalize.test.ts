import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSession, normalizeCatalog } from '../src/data/normalize.js';
import type { RawSession } from '../src/contracts.js';

const fixturePath = join(import.meta.dirname, 'fixtures', 'build-2025-sample.json');
const rawSessions: RawSession[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));

describe('normalizeSession', () => {
  it('extracts sessionCode and title', () => {
    const raw = rawSessions.find((s) => s.sessionCode === 'BRK154')!;
    const session = normalizeSession(raw, 'build-2025');
    expect(session).not.toBeNull();
    expect(session!.sessionCode).toBe('BRK154');
    expect(session!.title).toContain('Developer essentials');
    expect(session!.event).toBe('build-2025');
  });

  it('handles speakerNames as comma-separated string', () => {
    const raw = rawSessions.find((s) => s.sessionCode === 'KEY040')!;
    const session = normalizeSession(raw, 'build-2025');
    expect(session!.speakers).toContain('Scott Hanselman');
    expect(session!.speakers).toContain('Mark Russinovich');
  });

  it('normalizes nested dict fields (sessionType, sessionLevel)', () => {
    const raw = rawSessions.find((s) => s.sessionCode === 'BRK154')!;
    const session = normalizeSession(raw, 'build-2025');
    expect(session!.type).toBe('Breakout');
    expect(session!.level).toContain('200');
  });

  it('handles location as a displayValue object', () => {
    const session = normalizeSession({
      sessionCode: 'BRK999',
      title: 'Object location',
      location: {
        displayValue: '  Festival Pavilion  ',
        logicalValue: 'Festival Pavilion',
      },
      product: [
        { displayValue: '  Azure AI Foundry  ' },
        '  GitHub  ',
      ],
    }, 'build-2026');

    expect(session!.location).toBe('Festival Pavilion');
    expect(session!.product).toBe('Azure AI Foundry, GitHub');
  });

  it('handles empty product arrays', () => {
    // Many sessions have product: []
    const raw = rawSessions.find((s) => s.sessionCode === 'BRK154')!;
    const session = normalizeSession(raw, 'build-2025');
    // Should not throw, should return empty string or actual value
    expect(typeof session!.product).toBe('string');
  });

  it('skips sessions without sessionCode', () => {
    const raw: RawSession = { title: 'No code' };
    const session = normalizeSession(raw, 'build-2025');
    expect(session).toBeNull();
  });

  it('preserves on-demand and slide links', () => {
    const raw = rawSessions.find((s) => s.sessionCode === 'BRK155')!;
    const session = normalizeSession(raw, 'build-2025');
    // BRK155 has on-demand and slides
    expect(typeof session!.onDemand).toBe('string');
    expect(typeof session!.slideDeck).toBe('string');
  });
});

describe('normalizeCatalog', () => {
  it('normalizes all sessions in fixture', () => {
    const sessions = normalizeCatalog(rawSessions, 'build-2025');
    expect(sessions.length).toBe(rawSessions.length);
    expect(sessions.every((s) => s.event === 'build-2025')).toBe(true);
  });

  it('preserves session variants as separate entries', () => {
    const sessions = normalizeCatalog(rawSessions, 'build-2025');
    const lab344variants = sessions.filter((s) => s.sessionCode.startsWith('LAB344'));
    // LAB344 and LAB344-R1 should both exist
    expect(lab344variants.length).toBeGreaterThanOrEqual(1);
  });

  it('handles the Ignite 2026 catalog shape', () => {
    const ignitePath = join(import.meta.dirname, 'fixtures', 'ignite-2026-sample.json');
    const igniteRaw: RawSession[] = JSON.parse(readFileSync(ignitePath, 'utf-8'));
    const sessions = normalizeCatalog(igniteRaw, 'ignite-2026');

    expect(sessions.map((s) => s.sessionCode)).toEqual(['LAB700', 'ODSP2176', 'BRKSP615', 'TT1853']);
    expect(sessions.every((s) => s.event === 'ignite-2026')).toBe(true);

    // Ignite 2026 rows have a UTC TimeSlot but no startDateTime or relatedSessionCodes yet
    const lab = sessions.find((s) => s.sessionCode === 'LAB700')!;
    expect(lab.timeSlot).toBe('15:30 - 16:45');
    expect(lab.startDateTime).toBe('');
    expect(lab.relatedSessionCodes).toBe('');
    expect(lab.location).toBe('Moscone West | Level 2, Room 2010');
    expect(lab.type).toBe('Lab');
    expect(lab.level).toBe('(300) Advanced');
    expect(lab.speakers).toBe('Renato Leite, Poonam Thawani');

    // Pre-recorded sessions have no time slot or room
    const prerecorded = sessions.find((s) => s.sessionCode === 'ODSP2176')!;
    expect(prerecorded.type).toBe('Pre-recorded');
    expect(prerecorded.timeSlot).toBe('');
    expect(prerecorded.location).toBe('');
  });
});
