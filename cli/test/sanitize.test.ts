import { describe, it, expect } from 'vitest';
import { stripControlSequences } from '../src/data/sanitize.js';

describe('stripControlSequences', () => {
  it('removes CSI colour sequences', () => {
    expect(stripControlSequences('\x1B[31mred\x1B[0m')).toBe('red');
  });
  it('removes CSI cursor-move sequences', () => {
    expect(stripControlSequences('a\x1B[2Jb\x1B[H')).toBe('ab');
  });
  it('removes OSC 8 hyperlinks (BEL-terminated)', () => {
    expect(stripControlSequences('\x1B]8;;http://x\x07label\x1B]8;;\x07'))
      .toBe('label');
  });
  it('removes OSC 8 hyperlinks (ESC-\\-terminated)', () => {
    expect(stripControlSequences('\x1B]8;;http://x\x1B\\label\x1B]8;;\x1B\\'))
      .toBe('label');
  });
  it('removes OSC 52 clipboard writes', () => {
    expect(stripControlSequences('\x1B]52;c;PWNED\x07visible')).toBe('visible');
  });
  it('removes DCS strings', () => {
    expect(stripControlSequences('a\x1BP1;1qb\x1B\\c')).toBe('ac');
  });
  it('removes bare DEL and C1 controls', () => {
    expect(stripControlSequences('a\x7Fb\x9Bc\x84d')).toBe('abcd');
  });
  it('removes single-char ESC sequences', () => {
    expect(stripControlSequences('a\x1Bcb')).toBe('ab');
  });
  it('preserves TAB, LF, CR', () => {
    expect(stripControlSequences('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
  it('preserves Unicode characters', () => {
    expect(stripControlSequences('Hello 你好 🌍')).toBe('Hello 你好 🌍');
  });
  it('is idempotent', () => {
    const s = '\x1B[1mTitle\x1B[0m';
    expect(stripControlSequences(stripControlSequences(s))).toBe('Title');
  });
  it('handles empty strings', () => {
    expect(stripControlSequences('')).toBe('');
  });
  it('returns clean strings unchanged', () => {
    expect(stripControlSequences('Normal session title.')).toBe('Normal session title.');
  });
  it('strips half-formed CSI (no final byte): ESC byte must not survive', () => {
    const out = stripControlSequences('hi\x1B[31');
    expect(out).not.toContain('\x1B');
  });
  it('strips combined ANSI + OSC + C1 payloads', () => {
    const combined = '\x1B[1m\x1B]52;c;X\x07\x9Bsafe\x1B[0m';
    expect(stripControlSequences(combined)).toBe('safe');
  });
});
