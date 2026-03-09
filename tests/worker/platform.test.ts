import { describe, it, expect } from 'vitest';
import {
  isAdmin,
  getRole,
  canCreateRepo,
  getPlatformSettings,
  putPlatformSettings,
} from '../../worker/platform.js';
import type { Env } from '../../worker/env.js';

// ---------------------------------------------------------------------------
// In-memory KV stub
// ---------------------------------------------------------------------------

function createKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function makeEnv(admin = ''): Env {
  return {
    PLATFORM_ADMIN: admin,
    SESSIONS: createKvStub(),
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// isAdmin
// ---------------------------------------------------------------------------

describe('isAdmin', () => {
  it('returns true when address matches PLATFORM_ADMIN', () => {
    const env = makeEnv('0xAdMinAddr');
    expect(isAdmin(env, '0xAdMinAddr')).toBe(true);
  });

  it('is case-insensitive', () => {
    const env = makeEnv('0xAbCdEf');
    expect(isAdmin(env, '0xABCDEF')).toBe(true);
    expect(isAdmin(env, '0xabcdef')).toBe(true);
  });

  it('returns false for non-admin address', () => {
    const env = makeEnv('0xAdMinAddr');
    expect(isAdmin(env, '0xOtherAddr')).toBe(false);
  });

  it('returns false when PLATFORM_ADMIN is empty', () => {
    const env = makeEnv('');
    expect(isAdmin(env, '0xAnything')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPlatformSettings
// ---------------------------------------------------------------------------

describe('getPlatformSettings', () => {
  it('returns defaults when KV is empty', async () => {
    const kv = createKvStub();
    const settings = await getPlatformSettings(kv);
    expect(settings.openCreation).toBe(true);
    expect(settings.writers).toEqual([]);
    expect(settings.platformName).toBe('');
    expect(settings.platformDescription).toBe('');
  });

  it('parses stored settings', async () => {
    const kv = createKvStub();
    await kv.put(
      'platform:settings',
      JSON.stringify({
        openCreation: false,
        writers: ['0xWriter1'],
        platformName: 'MyInstance',
        platformDescription: 'A test instance',
      }),
    );
    const settings = await getPlatformSettings(kv);
    expect(settings.openCreation).toBe(false);
    expect(settings.writers).toEqual(['0xWriter1']);
    expect(settings.platformName).toBe('MyInstance');
  });

  it('fills missing fields with defaults', async () => {
    const kv = createKvStub();
    await kv.put('platform:settings', JSON.stringify({ openCreation: false }));
    const settings = await getPlatformSettings(kv);
    expect(settings.openCreation).toBe(false);
    expect(settings.writers).toEqual([]);
    expect(settings.platformName).toBe('');
  });

  it('returns defaults on invalid JSON', async () => {
    const kv = createKvStub();
    await kv.put('platform:settings', 'not json');
    const settings = await getPlatformSettings(kv);
    expect(settings.openCreation).toBe(true);
  });

  it('ignores non-array writers', async () => {
    const kv = createKvStub();
    await kv.put('platform:settings', JSON.stringify({ writers: 'not-array' }));
    const settings = await getPlatformSettings(kv);
    expect(settings.writers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// putPlatformSettings
// ---------------------------------------------------------------------------

describe('putPlatformSettings', () => {
  it('round-trips settings through KV', async () => {
    const kv = createKvStub();
    const original = {
      openCreation: false,
      writers: ['0xA', '0xB'],
      platformName: 'Test',
      platformDescription: 'Desc',
      retentionDepth: 50,
    };
    await putPlatformSettings(kv, original);
    const retrieved = await getPlatformSettings(kv);
    expect(retrieved).toEqual(original);
  });

  it('overwrites previous settings', async () => {
    const kv = createKvStub();
    await putPlatformSettings(kv, {
      openCreation: true,
      writers: [],
      platformName: '',
      platformDescription: '',
    });
    await putPlatformSettings(kv, {
      openCreation: false,
      writers: ['0xNew'],
      platformName: 'Updated',
      platformDescription: '',
    });
    const settings = await getPlatformSettings(kv);
    expect(settings.openCreation).toBe(false);
    expect(settings.writers).toEqual(['0xNew']);
    expect(settings.platformName).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// getRole
// ---------------------------------------------------------------------------

describe('getRole', () => {
  it('returns visitor when address is undefined', async () => {
    const env = makeEnv('0xAdmin');
    expect(await getRole(env, env.SESSIONS, undefined)).toBe('visitor');
  });

  it('returns admin for platform admin address', async () => {
    const env = makeEnv('0xAdmin');
    expect(await getRole(env, env.SESSIONS, '0xAdmin')).toBe('admin');
  });

  it('returns writer for listed writer', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: true,
      writers: ['0xWriter'],
      platformName: '',
      platformDescription: '',
    });
    expect(await getRole(env, env.SESSIONS, '0xWriter')).toBe('writer');
  });

  it('writer check is case-insensitive', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: true,
      writers: ['0xAbCd'],
      platformName: '',
      platformDescription: '',
    });
    expect(await getRole(env, env.SESSIONS, '0xABCD')).toBe('writer');
  });

  it('returns visitor for unknown address', async () => {
    const env = makeEnv('0xAdmin');
    expect(await getRole(env, env.SESSIONS, '0xStranger')).toBe('visitor');
  });
});

// ---------------------------------------------------------------------------
// canCreateRepo
// ---------------------------------------------------------------------------

describe('canCreateRepo', () => {
  it('admin can always create', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: false,
      writers: [],
      platformName: '',
      platformDescription: '',
    });
    expect(await canCreateRepo(env, env.SESSIONS, '0xAdmin')).toBe(true);
  });

  it('anyone can create when openCreation is true', async () => {
    const env = makeEnv('0xAdmin');
    // Default settings have openCreation: true
    expect(await canCreateRepo(env, env.SESSIONS, '0xRandom')).toBe(true);
  });

  it('listed writer can create when openCreation is false', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: false,
      writers: ['0xWriter'],
      platformName: '',
      platformDescription: '',
    });
    expect(await canCreateRepo(env, env.SESSIONS, '0xWriter')).toBe(true);
  });

  it('non-writer cannot create when openCreation is false', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: false,
      writers: ['0xWriter'],
      platformName: '',
      platformDescription: '',
    });
    expect(await canCreateRepo(env, env.SESSIONS, '0xRandom')).toBe(false);
  });

  it('writer check is case-insensitive', async () => {
    const env = makeEnv('0xAdmin');
    await putPlatformSettings(env.SESSIONS, {
      openCreation: false,
      writers: ['0xAbCd'],
      platformName: '',
      platformDescription: '',
    });
    expect(await canCreateRepo(env, env.SESSIONS, '0xABCD')).toBe(true);
  });
});
