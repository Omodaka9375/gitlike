import { describe, it, expect } from 'vitest';
import { shortCid, timeAgo, shortAddr, friendlyError } from '../../src/ui/dom.js';

describe('shortCid', () => {
  it('truncates long CIDs', () => {
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const result = shortCid(cid);
    expect(result).toMatch(/^bafybeig…y55fbzdi$/);
    expect(result.length).toBeLessThan(cid.length);
  });

  it('returns short strings unchanged', () => {
    expect(shortCid('abc')).toBe('abc');
  });

  it('respects custom length', () => {
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const result = shortCid(cid, 4);
    expect(result).toBe('bafy…bzdi');
  });
});

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns minutes for timestamps within the hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours for timestamps within the day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for timestamps within the month', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe('2d ago');
  });

  it('returns a date string for older timestamps', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    // Should return a locale date string, not a relative time
    expect(timeAgo(old)).not.toContain('ago');
  });
});

describe('shortAddr', () => {
  it('truncates long addresses', () => {
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });

  it('returns short strings unchanged', () => {
    expect(shortAddr('0x1234')).toBe('0x1234');
  });
});

describe('friendlyError', () => {
  it('extracts message from Error objects', () => {
    expect(friendlyError(new Error('Something broke'))).toBe('Something broke');
  });

  it('strips nested JSON from Pinata SDK errors', () => {
    const msg = 'Upload failed: {"status": 500, "detail": "blah"}';
    expect(friendlyError(new Error(msg))).toBe('Upload failed');
  });

  it('converts non-Error values to strings', () => {
    expect(friendlyError('raw string')).toBe('raw string');
    expect(friendlyError(42)).toBe('42');
  });
});
