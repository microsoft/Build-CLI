import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLimit } from '../src/commands/common.js';

describe('validateLimit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('accepts positive integers and trims whitespace', () => {
    expect(validateLimit('10')).toBe(10);
    expect(validateLimit(' 10 ')).toBe(10);
    expect(validateLimit('200')).toBe(200);
  });

  it('clamps values above the maximum', () => {
    expect(validateLimit('201')).toBe(200);
    expect(validateLimit('1000')).toBe(200);
    expect(process.stderr.write).toHaveBeenCalled();
  });

  it('rejects non-integer and non-positive values', () => {
    for (const value of ['0', '-5', 'abc', '', '1e9', '10abc', '1.5']) {
      process.exitCode = undefined;
      expect(validateLimit(value)).toBeNull();
      expect(process.exitCode).toBe(1);
    }
  });
});
