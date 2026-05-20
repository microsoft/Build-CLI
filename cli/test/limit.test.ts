import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('returns the parsed value when in range', () => {
    expect(validateLimit('10')).toBe(10);
    expect(process.exitCode).toBeUndefined();
  });

  it('accepts 1 as the minimum', () => {
    expect(validateLimit('1')).toBe(1);
  });

  it('clamps to 200 with a stderr warning', () => {
    expect(validateLimit('1000')).toBe(200);
    expect(process.stderr.write).toHaveBeenCalled();
  });

  it('rejects zero', () => {
    expect(validateLimit('0')).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it('rejects negative', () => {
    expect(validateLimit('-5')).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it('rejects non-numeric input', () => {
    expect(validateLimit('abc')).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it('rejects empty string', () => {
    expect(validateLimit('')).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it('parses scientific notation as the integer prefix (parseInt semantics)', () => {
    // parseInt('1e9', 10) === 1; documenting actual behaviour to keep this stable.
    expect(validateLimit('1e9')).toBe(1);
  });
});
