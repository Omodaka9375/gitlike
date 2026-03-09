import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import {
  generateRepoKey,
  exportKey,
  importRepoKey,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  encryptFile,
  decryptBlob,
  wrapRepoKey,
  unwrapRepoKey,
  deriveUEK,
  deriveUEKFromSignature,
  encryptStream,
  decryptStream,
  shouldStream,
  cacheRepoKey,
  getCachedRepoKey,
  clearCachedRepoKeys,
  createKeyBundleEpoch,
  rotateRepoKey,
  unlockRepoKey,
  hexToBytes,
  bytesToHex,
  bufferToBase64,
  base64ToBuffer,
} from '../../src/encryption.js';

// Polyfill sessionStorage for Node/vitest environment
const _store = new Map<string, string>();
if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (k: string) => _store.get(k) ?? null,
      setItem: (k: string, v: string) => _store.set(k, v),
      removeItem: (k: string) => _store.delete(k),
      clear: () => _store.clear(),
      get length() { return _store.size; },
      key: (i: number) => [..._store.keys()][i] ?? null,
    },
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

describe('hexToBytes / bytesToHex', () => {
  it('round-trips hex', () => {
    const hex = 'deadbeef01020304';
    const bytes = hexToBytes(hex);
    expect(bytesToHex(bytes)).toBe(hex);
  });

  it('handles 0x prefix', () => {
    const bytes = hexToBytes('0xaabb');
    expect(bytesToHex(bytes)).toBe('aabb');
  });

  it('handles empty string', () => {
    const bytes = hexToBytes('');
    expect(bytes.length).toBe(0);
  });
});

describe('bufferToBase64 / base64ToBuffer', () => {
  it('round-trips binary data', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const b64 = bufferToBase64(original.buffer);
    const restored = new Uint8Array(base64ToBuffer(b64));
    expect(restored).toEqual(original);
  });

  it('handles empty buffer', () => {
    const b64 = bufferToBase64(new ArrayBuffer(0));
    const restored = base64ToBuffer(b64);
    expect(restored.byteLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Key generation & export/import
// ---------------------------------------------------------------------------

describe('generateRepoKey', () => {
  it('generates an AES-256-GCM key', async () => {
    const key = await generateRepoKey();
    expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect(key.extractable).toBe(true);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });
});

describe('exportKey / importRepoKey', () => {
  it('round-trips a key', async () => {
    const key = await generateRepoKey();
    const raw = await exportKey(key);
    expect(raw.byteLength).toBe(32);
    const imported = await importRepoKey(raw);
    const raw2 = await exportKey(imported);
    expect(new Uint8Array(raw)).toEqual(new Uint8Array(raw2));
  });
});

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt/decrypt
// ---------------------------------------------------------------------------

describe('encrypt / decrypt', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await generateRepoKey();
  });

  it('round-trips binary data', async () => {
    const plaintext = new TextEncoder().encode('hello world');
    const encrypted = await encrypt(key, plaintext.buffer);
    // Encrypted output = 12 byte IV + ciphertext (>=plaintext + 16 byte tag)
    expect(encrypted.byteLength).toBeGreaterThan(plaintext.byteLength + 12);
    const decrypted = await decrypt(key, encrypted);
    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const plaintext = new TextEncoder().encode('determinism test');
    const a = await encrypt(key, plaintext.buffer);
    const b = await encrypt(key, plaintext.buffer);
    expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
  });

  it('fails with wrong key', async () => {
    const otherKey = await generateRepoKey();
    const plaintext = new TextEncoder().encode('secret');
    const encrypted = await encrypt(key, plaintext.buffer);
    await expect(decrypt(otherKey, encrypted)).rejects.toThrow();
  });

  it('handles empty plaintext', async () => {
    const encrypted = await encrypt(key, new ArrayBuffer(0));
    const decrypted = await decrypt(key, encrypted);
    expect(decrypted.byteLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// String encrypt/decrypt
// ---------------------------------------------------------------------------

describe('encryptString / decryptString', () => {
  it('round-trips a string', async () => {
    const key = await generateRepoKey();
    const original = 'Hello, 世界! 🔐';
    const encrypted = await encryptString(key, original);
    expect(typeof encrypted).toBe('string');
    const decrypted = await decryptString(key, encrypted);
    expect(decrypted).toBe(original);
  });

  it('handles empty string', async () => {
    const key = await generateRepoKey();
    const encrypted = await encryptString(key, '');
    expect(await decryptString(key, encrypted)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Key wrapping (AES-KW)
// ---------------------------------------------------------------------------

describe('wrapRepoKey / unwrapRepoKey', () => {
  it('round-trips a repo key through wrap/unwrap', async () => {
    // Create a shared secret (32 random bytes)
    const sharedSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const uek = await deriveUEK(sharedSecret, 'test-repo-id', 0);
    const repoKey = await generateRepoKey();

    const wrapped = await wrapRepoKey(uek, repoKey);
    expect(typeof wrapped).toBe('string');

    const unwrapped = await unwrapRepoKey(uek, wrapped);
    const originalRaw = await exportKey(repoKey);
    const unwrappedRaw = await exportKey(unwrapped);
    expect(new Uint8Array(unwrappedRaw)).toEqual(new Uint8Array(originalRaw));
  });

  it('fails with wrong UEK', async () => {
    const secret1 = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const secret2 = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const uek1 = await deriveUEK(secret1, 'repo', 0);
    const uek2 = await deriveUEK(secret2, 'repo', 0);
    const repoKey = await generateRepoKey();

    const wrapped = await wrapRepoKey(uek1, repoKey);
    await expect(unwrapRepoKey(uek2, wrapped)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deriveUEK
// ---------------------------------------------------------------------------

describe('deriveUEK', () => {
  it('produces deterministic keys from same inputs', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const a = await deriveUEK(secret, 'repo-1', 0);
    const b = await deriveUEK(secret, 'repo-1', 0);
    // Can't directly compare CryptoKeys, but wrapping/unwrapping should work
    const repoKey = await generateRepoKey();
    const wrapped = await wrapRepoKey(a, repoKey);
    const unwrapped = await unwrapRepoKey(b, wrapped);
    // If keys are the same, unwrap succeeds
    const rawA = new Uint8Array(await exportKey(repoKey));
    const rawB = new Uint8Array(await exportKey(unwrapped));
    expect(rawB).toEqual(rawA);
  });

  it('produces different keys for different repos', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const uek1 = await deriveUEK(secret, 'repo-a', 0);
    const uek2 = await deriveUEK(secret, 'repo-b', 0);
    const repoKey = await generateRepoKey();
    const wrapped = await wrapRepoKey(uek1, repoKey);
    await expect(unwrapRepoKey(uek2, wrapped)).rejects.toThrow();
  });

  it('produces different keys for different epochs', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const uek1 = await deriveUEK(secret, 'repo', 0);
    const uek2 = await deriveUEK(secret, 'repo', 1);
    const repoKey = await generateRepoKey();
    const wrapped = await wrapRepoKey(uek1, repoKey);
    await expect(unwrapRepoKey(uek2, wrapped)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deriveUEKFromSignature
// ---------------------------------------------------------------------------

describe('deriveUEKFromSignature', () => {
  it('produces a working UEK from a signature hex', async () => {
    const sigHex =
      '0x' + bytesToHex(crypto.getRandomValues(new Uint8Array(65)));
    const uek = await deriveUEKFromSignature(sigHex, 'repo-1', 0);
    const repoKey = await generateRepoKey();
    const wrapped = await wrapRepoKey(uek, repoKey);
    const unwrapped = await unwrapRepoKey(uek, wrapped);
    const a = new Uint8Array(await exportKey(repoKey));
    const b = new Uint8Array(await exportKey(unwrapped));
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// Streaming encryption
// ---------------------------------------------------------------------------

describe('shouldStream', () => {
  it('returns false for small files', () => {
    expect(shouldStream(1024)).toBe(false);
    expect(shouldStream(5 * 1024 * 1024)).toBe(false);
  });

  it('returns true for large files', () => {
    expect(shouldStream(5 * 1024 * 1024 + 1)).toBe(true);
  });
});

describe('encryptStream / decryptStream', () => {
  it('round-trips data through stream encryption', async () => {
    const key = await generateRepoKey();
    const data = crypto.getRandomValues(new Uint8Array(256));

    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const encrypted = encryptStream(key, input, 128);
    const decrypted = decryptStream(key, encrypted);

    const reader = decrypted.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    expect(result).toEqual(data);
  });

  it('handles multiple chunks', async () => {
    const key = await generateRepoKey();
    // 300 bytes with 128-byte chunk = 3 chunks (128, 128, 44)
    const data = crypto.getRandomValues(new Uint8Array(300));

    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const encrypted = encryptStream(key, input, 128);
    const decrypted = decryptStream(key, encrypted);

    const reader = decrypted.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    expect(result).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// File encryption
// ---------------------------------------------------------------------------

describe('encryptFile / decryptBlob', () => {
  it('round-trips a small file', async () => {
    const key = await generateRepoKey();
    const content = new TextEncoder().encode('file content here');
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const encrypted = await encryptFile(key, file);
    expect(encrypted.name).toBe('test.txt');
    expect(encrypted.type).toBe('application/octet-stream');

    const encBuf = await encrypted.arrayBuffer();
    const decrypted = await decryptBlob(key, encBuf, false);
    expect(new Uint8Array(decrypted)).toEqual(content);
  });
});

// ---------------------------------------------------------------------------
// Key cache (sessionStorage)
// ---------------------------------------------------------------------------

describe('key cache', () => {
  beforeEach(() => {
    _store.clear();
  });

  it('caches and retrieves a repo key', async () => {
    const key = await generateRepoKey();
    await cacheRepoKey('repo-1', 0, key);
    const cached = await getCachedRepoKey('repo-1', 0);
    expect(cached).not.toBeNull();
    const a = new Uint8Array(await exportKey(key));
    const b = new Uint8Array(await exportKey(cached!));
    expect(b).toEqual(a);
  });

  it('returns null for missing cache', async () => {
    const cached = await getCachedRepoKey('missing', 0);
    expect(cached).toBeNull();
  });

  it('clears keys for a specific repo', async () => {
    const key = await generateRepoKey();
    await cacheRepoKey('repo-1', 0, key);
    await cacheRepoKey('repo-1', 1, key);
    await cacheRepoKey('repo-2', 0, key);
    clearCachedRepoKeys('repo-1');
    expect(await getCachedRepoKey('repo-1', 0)).toBeNull();
    expect(await getCachedRepoKey('repo-1', 1)).toBeNull();
    expect(await getCachedRepoKey('repo-2', 0)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Key bundle operations
// ---------------------------------------------------------------------------

describe('createKeyBundleEpoch', () => {
  it('creates an epoch with wrapped keys for each address', async () => {
    const sharedSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const addr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;

    const { epochData, repoKey } = await createKeyBundleEpoch(
      0,
      'fakePubKey',
      [addr],
      async (_addr, epoch) => deriveUEK(sharedSecret, 'repo', epoch),
    );

    expect(epochData.ownerPublicKey).toBe('fakePubKey');
    expect(epochData.wrappedKeys[addr]).toBeDefined();
    expect(epochData.createdAt).toBeTruthy();

    // Verify wrapped key can be unwrapped
    const uek = await deriveUEK(sharedSecret, 'repo', 0);
    const unwrapped = await unwrapRepoKey(uek, epochData.wrappedKeys[addr]);
    const a = new Uint8Array(await exportKey(repoKey));
    const b = new Uint8Array(await exportKey(unwrapped));
    expect(b).toEqual(a);
  });
});

describe('rotateRepoKey', () => {
  it('creates a new epoch and preserves old ones', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const addr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
    const mkUEK = async (_addr: `0x${string}`, epoch: number) =>
      deriveUEK(secret, 'repo', epoch);

    const { epochData } = await createKeyBundleEpoch(0, 'pk', [addr], mkUEK);
    const bundle = { 0: epochData };

    const { updatedBundle, newEpoch, repoKey } = await rotateRepoKey(
      bundle,
      'pk',
      [addr],
      mkUEK,
    );

    expect(newEpoch).toBe(1);
    expect(updatedBundle[0]).toBe(epochData);
    expect(updatedBundle[1]).toBeDefined();

    // New epoch key is different from old
    const uek1 = await mkUEK(addr, 1);
    const unwrapped = await unwrapRepoKey(uek1, updatedBundle[1].wrappedKeys[addr]);
    const raw = new Uint8Array(await exportKey(unwrapped));
    const rkRaw = new Uint8Array(await exportKey(repoKey));
    expect(raw).toEqual(rkRaw);
  });
});

describe('unlockRepoKey', () => {
  beforeEach(() => {
    _store.clear();
  });

  it('unlocks and caches the repo key', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const addr = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
    const mkUEK = async (_addr: `0x${string}`, epoch: number) =>
      deriveUEK(secret, 'repo', epoch);

    const { epochData, repoKey } = await createKeyBundleEpoch(0, 'pk', [addr], mkUEK);
    const bundle = { 0: epochData };

    const unlocked = await unlockRepoKey('repo', bundle, 0, addr, (epoch) =>
      mkUEK(addr, epoch),
    );

    const a = new Uint8Array(await exportKey(repoKey));
    const b = new Uint8Array(await exportKey(unlocked));
    expect(b).toEqual(a);

    // Should now be cached
    const cached = await getCachedRepoKey('repo', 0);
    expect(cached).not.toBeNull();
  });

  it('throws for unknown address', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const owner = '0xdddddddddddddddddddddddddddddddddddddd' as `0x${string}`;
    const stranger = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as `0x${string}`;
    const mkUEK = async (_addr: `0x${string}`, epoch: number) =>
      deriveUEK(secret, 'repo', epoch);

    const { epochData } = await createKeyBundleEpoch(0, 'pk', [owner], mkUEK);
    const bundle = { 0: epochData };

    await expect(
      unlockRepoKey('repo', bundle, 0, stranger, (epoch) => mkUEK(stranger, epoch)),
    ).rejects.toThrow('No key found');
  });
});
