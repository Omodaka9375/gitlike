import { describe, it, expect } from 'vitest';
import { errorMsg, isOwnerOrWriter } from '../../worker/utils.js';
import type { Manifest } from '../../worker/ipfs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal manifest factory. */
function makeManifest(owners: string[], writers: string[] = []): Manifest {
  return {
    type: 'manifest',
    name: 'test-repo',
    description: '',
    defaultBranch: 'main',
    branches: { main: 'cidMain' },
    acl: {
      owners: owners as Manifest['acl']['owners'],
      writers: writers as Manifest['acl']['writers'],
      agents: {},
    },
  };
}

// ---------------------------------------------------------------------------
// errorMsg
// ---------------------------------------------------------------------------

describe('errorMsg', () => {
  it('extracts message from a plain Error', () => {
    expect(errorMsg(new Error('something broke'))).toBe('something broke');
  });

  it('strips JSON suffix from Error message', () => {
    expect(errorMsg(new Error('Upload failed: {"code":500}'))).toBe('Upload failed');
  });

  it('converts non-Error to string', () => {
    expect(errorMsg('raw string')).toBe('raw string');
    expect(errorMsg(42)).toBe('42');
    expect(errorMsg(null)).toBe('null');
  });

  it('handles Error with empty message', () => {
    expect(errorMsg(new Error(''))).toBe('');
  });

  it('returns full message when no JSON is present', () => {
    expect(errorMsg(new Error('no json here'))).toBe('no json here');
  });
});

// ---------------------------------------------------------------------------
// isOwnerOrWriter
// ---------------------------------------------------------------------------

describe('isOwnerOrWriter', () => {
  it('returns true for an owner', () => {
    const manifest = makeManifest(['0xABC']);
    expect(isOwnerOrWriter('0xABC', manifest)).toBe(true);
  });

  it('returns true for a writer', () => {
    const manifest = makeManifest(['0xOWNER'], ['0xWRITER']);
    expect(isOwnerOrWriter('0xWRITER', manifest)).toBe(true);
  });

  it('is case-insensitive', () => {
    const manifest = makeManifest(['0xaBcDeF']);
    expect(isOwnerOrWriter('0xABCDEF', manifest)).toBe(true);
    expect(isOwnerOrWriter('0xabcdef', manifest)).toBe(true);
  });

  it('returns false for an unrelated address', () => {
    const manifest = makeManifest(['0xOWNER'], ['0xWRITER']);
    expect(isOwnerOrWriter('0xRANDOM', manifest)).toBe(false);
  });

  it('returns false for empty ACL', () => {
    const manifest = makeManifest([], []);
    expect(isOwnerOrWriter('0xANYONE', manifest)).toBe(false);
  });

  it('works with multiple owners and writers', () => {
    const manifest = makeManifest(['0xA', '0xB', '0xC'], ['0xD', '0xE']);
    expect(isOwnerOrWriter('0xC', manifest)).toBe(true);
    expect(isOwnerOrWriter('0xE', manifest)).toBe(true);
    expect(isOwnerOrWriter('0xF', manifest)).toBe(false);
  });
});
