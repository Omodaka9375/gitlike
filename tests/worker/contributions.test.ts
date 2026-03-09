import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordActivity } from '../../worker/mutations.js';
import type { Env } from '../../worker/env.js';

// ---------------------------------------------------------------------------
// Mock KV store
// ---------------------------------------------------------------------------

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function createEnvWithKV(kv: KVNamespace): Env {
  return { SESSIONS: kv } as unknown as Env;
}

// ---------------------------------------------------------------------------
// recordActivity
// ---------------------------------------------------------------------------

describe('recordActivity', () => {
  let kv: KVNamespace & { _store: Map<string, string> };
  let env: Env;

  beforeEach(() => {
    kv = createMockKV() as KVNamespace & { _store: Map<string, string> };
    env = createEnvWithKV(kv);
  });

  it('creates a new activity entry when none exists', async () => {
    await recordActivity(env, '0xABC123');

    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const key = `activity:0xabc123:${year}`;

    expect(kv.put).toHaveBeenCalledWith(key, expect.any(String));
    const stored = JSON.parse(kv._store.get(key)!);
    expect(stored[today]).toBe(1);
  });

  it('increments an existing day count', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const key = `activity:0xabc123:${year}`;

    // Seed with existing data
    kv._store.set(key, JSON.stringify({ [today]: 3 }));

    await recordActivity(env, '0xABC123');

    const stored = JSON.parse(kv._store.get(key)!);
    expect(stored[today]).toBe(4);
  });

  it('lowercases the address', async () => {
    await recordActivity(env, '0xABCDEF');

    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    expect(kv.get).toHaveBeenCalledWith(`activity:0xabcdef:${year}`);
  });

  it('preserves other days in the record', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const key = `activity:0xabc:${year}`;
    const existing = { '2026-01-15': 5, '2026-02-20': 2 };
    kv._store.set(key, JSON.stringify(existing));

    await recordActivity(env, '0xABC');

    const stored = JSON.parse(kv._store.get(key)!);
    expect(stored['2026-01-15']).toBe(5);
    expect(stored['2026-02-20']).toBe(2);
    expect(stored[today]).toBe(1);
  });

  it('does not throw if KV read fails', async () => {
    (kv.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('KV down'));
    await expect(recordActivity(env, '0xABC')).resolves.toBeUndefined();
  });

  it('does not throw if KV write fails', async () => {
    (kv.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('KV down'));
    await expect(recordActivity(env, '0xABC')).resolves.toBeUndefined();
  });
});
