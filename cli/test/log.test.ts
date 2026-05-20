import { describe, it, expect, vi, afterEach } from 'vitest';
import { debugLog } from '../src/log.js';

describe('debugLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MSEVENTS_DEBUG;
  });

  it('writes nothing when MSEVENTS_DEBUG is unset', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    debugLog('hello');
    expect(spy).not.toHaveBeenCalled();
  });

  it('writes one prefixed line when MSEVENTS_DEBUG is set', () => {
    process.env.MSEVENTS_DEBUG = '1';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    debugLog('hello');
    expect(spy).toHaveBeenCalledWith('[msevents:debug] hello\n');
  });
});
