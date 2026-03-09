import { describe, it, expect, vi } from 'vitest';
import { createStorage } from '../../worker/storage.js';
import type { StorageProvider } from '../../worker/storage.js';
import type { Env } from '../../worker/env.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal env with Pinata credentials only. */
function pinataEnv(overrides: Partial<Env> = {}): Env {
  return {
    SESSIONS: {} as KVNamespace,
    REPO_LOCK: {} as DurableObjectNamespace,
    SOCIAL_LOCK: {} as DurableObjectNamespace,
    ASSETS: { fetch: async () => new Response() },
    PINATA_JWT: 'test-jwt',
    PINATA_GATEWAY: 'test.mypinata.cloud',
    ALLOWED_ORIGIN: 'https://example.com',
    PLATFORM_ADMIN: '0xAdmin',
    ...overrides,
  };
}

/** Env with both Pinata and Filebase credentials. */
function dualEnv(overrides: Partial<Env> = {}): Env {
  return pinataEnv({
    FILEBASE_TOKEN: 'fb-token',
    FILEBASE_BUCKET: 'fb-bucket',
    FILEBASE_KEY: 'fb-key',
    FILEBASE_SECRET: 'fb-secret',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe('createStorage — provider selection', () => {
  it('defaults to pinata when STORAGE_PROVIDER is unset', () => {
    const provider = createStorage(pinataEnv());
    expect(provider.name).toContain('pinata');
  });

  it('selects pinata when STORAGE_PROVIDER is explicitly "pinata"', () => {
    const provider = createStorage(pinataEnv({ STORAGE_PROVIDER: 'pinata' }));
    expect(provider.name).toContain('pinata');
  });

  it('selects filebase when STORAGE_PROVIDER is "filebase"', () => {
    const env = dualEnv({ STORAGE_PROVIDER: 'filebase' });
    const provider = createStorage(env);
    expect(provider.name).toBe('filebase');
  });

  it('is case-insensitive for STORAGE_PROVIDER', () => {
    const env = dualEnv({ STORAGE_PROVIDER: 'Filebase' });
    const provider = createStorage(env);
    expect(provider.name).toBe('filebase');
  });
});

// ---------------------------------------------------------------------------
// Mirrored provider
// ---------------------------------------------------------------------------

describe('createStorage — mirrored provider', () => {
  it('returns mirrored provider when Filebase creds are present with Pinata primary', () => {
    const provider = createStorage(dualEnv());
    expect(provider.name).toBe('pinata+filebase');
  });

  it('does not mirror when only FILEBASE_TOKEN is set (no bucket)', () => {
    const provider = createStorage(pinataEnv({ FILEBASE_TOKEN: 'tok' }));
    expect(provider.name).toBe('pinata');
  });

  it('does not mirror when only FILEBASE_BUCKET is set (no token)', () => {
    const provider = createStorage(pinataEnv({ FILEBASE_BUCKET: 'bkt' }));
    expect(provider.name).toBe('pinata');
  });

  it('does not mirror when STORAGE_PROVIDER is explicitly filebase', () => {
    const env = dualEnv({ STORAGE_PROVIDER: 'filebase' });
    const provider = createStorage(env);
    // Should be plain filebase, not mirrored
    expect(provider.name).toBe('filebase');
  });
});

// ---------------------------------------------------------------------------
// Gateway URL
// ---------------------------------------------------------------------------

describe('StorageProvider.gatewayUrl', () => {
  it('builds a Pinata gateway URL', () => {
    const provider = createStorage(pinataEnv({ PINATA_GATEWAY: 'my.mypinata.cloud' }));
    const url = provider.gatewayUrl('bafyabc123');
    expect(url).toBe('https://my.mypinata.cloud/ipfs/bafyabc123');
  });

  it('appends path when provided', () => {
    const provider = createStorage(pinataEnv({ PINATA_GATEWAY: 'gw.test' }));
    const url = provider.gatewayUrl('bafyabc', 'README.md');
    expect(url).toBe('https://gw.test/ipfs/bafyabc/README.md');
  });

  it('builds a Filebase gateway URL', () => {
    const env = dualEnv({ STORAGE_PROVIDER: 'filebase', FILEBASE_GATEWAY: 'https://fb.gw.io' });
    const provider = createStorage(env);
    expect(provider.gatewayUrl('bafyxyz')).toBe('https://fb.gw.io/ipfs/bafyxyz');
  });
});
