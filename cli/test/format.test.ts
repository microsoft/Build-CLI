import { describe, it, expect } from 'vitest';
import { formatSessionShort, formatSessionFull, formatSearchResults } from '../src/output/format.js';
import type { Session } from '../src/contracts.js';

function dirtySession(): Session {
  return {
    sessionCode: 'BRK999',
    title: '\x1B[31mInjected\x1B[0m',
    description: 'Body\x07with\x9Bcontrols',
    speakers: 'Alice\x1B]8;;http://evil\x07',
    timeSlot: '',
    startDateTime: '',
    endDateTime: '',
    location: '\x1B[2JLoc',
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
  };
}

describe('format-time defensive sanitize', () => {
  it('strips escapes from short format', () => {
    const out = formatSessionShort(dirtySession());
    expect(out).not.toContain('\x1B');
    expect(out).not.toContain('\x07');
    expect(out).not.toContain('\x9B');
    expect(out).toContain('Injected');
    expect(out).toContain('Alice');
  });
  it('strips escapes from full format', () => {
    const out = formatSessionFull(dirtySession());
    expect(out).not.toContain('\x1B');
    expect(out).not.toContain('\x07');
    expect(out).not.toContain('\x9B');
  });
  it('leaves JSON output to JSON.stringify (escape bytes become \\u001b)', () => {
    const out = formatSearchResults(
      [{ session: dirtySession(), score: 1 }],
      true,
    );
    expect(out).toMatch(/\\u001[bB]/);
  });
});
