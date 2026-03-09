import { describe, it, expect } from 'vitest';
import { validateAlias, checkRepoAccess, MAX_FILES_PER_COMMIT } from '../../worker/middleware.js';
import type { Manifest } from '../../worker/ipfs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(
  owners: string[],
  writers: string[] = [],
  visibility: 'public' | 'private' = 'public',
): Manifest {
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
    visibility,
  };
}

/** Minimal Hono Context stub. */
function fakeContext(address?: string) {
  const vars: Record<string, string | undefined> = { address };
  const headers: Record<string, string> = {};
  return {
    get: (k: string) => vars[k],
    set: (k: string, v: string) => {
      vars[k] = v;
    },
    header: (_k: string, _v: string) => {
      headers[_k] = _v;
    },
    json: (body: unknown, status?: number) => ({ body, status }),
  } as unknown as import('hono').Context<import('../../worker/index.js').HonoEnv>;
}

// ---------------------------------------------------------------------------
// validateAlias
// ---------------------------------------------------------------------------

describe('validateAlias', () => {
  it('returns null for a valid alias', () => {
    expect(validateAlias('alice')).toBeNull();
  });

  it('allows underscores and hyphens', () => {
    expect(validateAlias('my-alias_01')).toBeNull();
  });

  it('allows single-character aliases', () => {
    expect(validateAlias('a')).toBeNull();
  });

  it('allows max-length alias (32 chars)', () => {
    expect(validateAlias('a'.repeat(32))).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateAlias('')).not.toBeNull();
  });

  it('rejects alias longer than 32 chars', () => {
    expect(validateAlias('a'.repeat(33))).not.toBeNull();
  });

  it('rejects special characters', () => {
    expect(validateAlias('al!ce')).not.toBeNull();
    expect(validateAlias('al ice')).not.toBeNull();
    expect(validateAlias('al@ce')).not.toBeNull();
  });

  it('rejects dots', () => {
    expect(validateAlias('al.ice')).not.toBeNull();
  });

  it('error message describes the constraint', () => {
    const err = validateAlias('');
    expect(err).toContain('required');
    const err2 = validateAlias('$$');
    expect(err2).toContain('1-32');
  });
});

// ---------------------------------------------------------------------------
// checkRepoAccess
// ---------------------------------------------------------------------------

describe('checkRepoAccess', () => {
  it('returns null for public repos', () => {
    const m = makeManifest(['0xOwner'], [], 'public');
    expect(checkRepoAccess(fakeContext(), m)).toBeNull();
  });

  it('returns null for public repos without visibility field', () => {
    const m = makeManifest(['0xOwner']);
    delete (m as Record<string, unknown>).visibility;
    expect(checkRepoAccess(fakeContext(), m)).toBeNull();
  });

  it('blocks unauthenticated access to private repos', () => {
    const m = makeManifest(['0xOwner'], [], 'private');
    const result = checkRepoAccess(fakeContext(undefined), m) as unknown as {
      body: { error: string };
      status: number;
    };
    expect(result).not.toBeNull();
    expect(result.status).toBe(404);
  });

  it('allows owner access to private repos', () => {
    const m = makeManifest(['0xOwner'], [], 'private');
    expect(checkRepoAccess(fakeContext('0xOwner'), m)).toBeNull();
  });

  it('allows writer access to private repos', () => {
    const m = makeManifest(['0xOwner'], ['0xWriter'], 'private');
    expect(checkRepoAccess(fakeContext('0xWriter'), m)).toBeNull();
  });

  it('blocks strangers from private repos', () => {
    const m = makeManifest(['0xOwner'], ['0xWriter'], 'private');
    const result = checkRepoAccess(fakeContext('0xStranger'), m) as unknown as {
      body: { error: string };
      status: number;
    };
    expect(result).not.toBeNull();
    expect(result.status).toBe(404);
  });

  it('is case-insensitive for owner check', () => {
    const m = makeManifest(['0xAbCdEf'], [], 'private');
    expect(checkRepoAccess(fakeContext('0xABCDEF'), m)).toBeNull();
    expect(checkRepoAccess(fakeContext('0xabcdef'), m)).toBeNull();
  });

  it('is case-insensitive for writer check', () => {
    const m = makeManifest(['0xOwner'], ['0xAbCdEf'], 'private');
    expect(checkRepoAccess(fakeContext('0xabcdef'), m)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MAX_FILES_PER_COMMIT
// ---------------------------------------------------------------------------

describe('MAX_FILES_PER_COMMIT', () => {
  it('is a positive number', () => {
    expect(MAX_FILES_PER_COMMIT).toBeGreaterThan(0);
  });

  it('equals 200', () => {
    expect(MAX_FILES_PER_COMMIT).toBe(200);
  });
});
