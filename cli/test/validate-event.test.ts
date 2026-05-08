import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEventId } from '../src/commands/common.js';

describe('validateEventId', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('returns true for a known event ID', () => {
    expect(validateEventId('build-2025')).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns false and sets exitCode for an unknown event ID', () => {
    expect(validateEventId('unknown-event')).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown event: unknown-event'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('build-2025'),
    );
  });
});
