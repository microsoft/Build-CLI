import { describe, expect, it } from 'vitest';
import type { Session } from '../src/contracts.js';
import { formatSearchResults, formatSessionFull, formatSessionShort } from '../src/output/format.js';

function session(overrides: Partial<Session> = {}): Session {
  return {
    sessionCode: 'BRK999',
    title: '\x1B[31mInjected\x1B[0m',
    description: 'line 1\nline 2\x1B]52;c;PWNED\x07',
    speakers: 'Alice\x1B]8;;https://evil.example\x07',
    timeSlot: '',
    startDateTime: '',
    endDateTime: '',
    location: '\x1B[2JRoom A',
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

describe('format sanitization', () => {
  it('strips control sequences from human-readable output', () => {
    const short = formatSessionShort(session());
    const full = formatSessionFull(session());

    expect(short).not.toContain('\x1B');
    expect(short).not.toContain('\x07');
    expect(full).not.toContain('\x1B');
    expect(full).not.toContain('\x07');
    expect(full).toContain('line 1\nline 2');
  });

  it('strips control sequences from JSON output too', () => {
    const output = formatSearchResults([{ session: session(), score: 1 }], true);

    expect(output).not.toMatch(/\\u001[bB]/);
    expect(output).not.toMatch(/\\u0007/);
    expect(output).toContain('Injected');
  });

  it('does not print Invalid Date for malformed startDateTime', () => {
    const output = formatSessionShort(session({
      startDateTime: 'not a real date',
      timeSlot: '',
    }));

    expect(output).not.toContain('Invalid Date');
    expect(output).toContain('not a real date');
  });
});
