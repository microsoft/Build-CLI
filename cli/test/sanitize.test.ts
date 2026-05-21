import { describe, expect, it } from 'vitest';
import { stripControlSequences } from '../src/data/sanitize.js';

describe('stripControlSequences', () => {
  it('removes CSI color and cursor sequences', () => {
    expect(stripControlSequences('\x1B[31mred\x1B[0m\x1B[2J')).toBe('red');
  });

  it('removes OSC hyperlinks and clipboard writes', () => {
    expect(stripControlSequences('\x1B]8;;https://evil.example\x07label\x1B]8;;\x07'))
      .toBe('label');
    expect(stripControlSequences('\x1B]52;c;PWNED\x07visible')).toBe('visible');
  });

  it('removes DCS strings and bare escape tails', () => {
    expect(stripControlSequences('a\x1BPpayload\x1B\\b\x1Bcb')).toBe('abb');
  });

  it('removes control bytes but preserves tab, newline, and carriage return', () => {
    expect(stripControlSequences('a\x00b\tc\nd\re\x7Ff\x9Bg')).toBe('ab\tc\nd\refg');
  });

  it('is idempotent and preserves unicode text', () => {
    const input = '\x1B[1mHello 你好\x1B[0m';
    expect(stripControlSequences(stripControlSequences(input))).toBe('Hello 你好');
  });
});
