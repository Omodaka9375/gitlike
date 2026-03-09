// ---------------------------------------------------------------------------
// GitLike — Client-Side Encryption
// AES-256-GCM encryption with ECDH key exchange and key epoch rotation.
// Uses Web Crypto API exclusively — no server-side crypto awareness needed.
// ---------------------------------------------------------------------------

import type { Address, GroupId, KeyBundle, KeyBundleEpoch } from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** AES-GCM initialization vector length in bytes. */
const IV_LENGTH = 12;

/** Streaming chunk size in bytes (1 MB). */
const CHUNK_SIZE = 1024 * 1024;

/** Files larger than this threshold use streaming encryption. */
const STREAM_THRESHOLD = 5 * 1024 * 1024;

/** Session storage prefix for cached repo keys. */
const CACHE_PREFIX = 'ek:';

// ---------------------------------------------------------------------------
// Key Derivation
// ---------------------------------------------------------------------------

/**
 * Derive a shared secret via ECDH from a raw private key and a peer's public key.
 * Both keys are raw secp256k1 bytes (uncompressed: 65 bytes, compressed: 33 bytes).
 */
export async function deriveSharedSecret(
  privateKeyHex: string,
  peerPublicKeyHex: string,
): Promise<ArrayBuffer> {
  const privateBytes = hexToBytes(privateKeyHex);
  const publicBytes = hexToBytes(peerPublicKeyHex);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    buildPkcs8(privateBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  return crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
}

/**
 * Derive a User Encryption Key (UEK) from a shared secret using HKDF.
 * Returns a CryptoKey suitable for AES-KW (key wrapping).
 */
export async function deriveUEK(
  sharedSecret: ArrayBuffer,
  repoId: GroupId,
  epoch: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);

  const info = new TextEncoder().encode(`gitlike-repo-key-${repoId}-epoch-${epoch}`);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
    baseKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Derive a UEK from a wallet signature (fallback when ECDH is unavailable).
 * Uses HKDF on the signature bytes as keying material.
 */
export async function deriveUEKFromSignature(
  signatureHex: string,
  repoId: GroupId,
  epoch: number,
): Promise<CryptoKey> {
  const sigBytes = hexToBytes(signatureHex);
  const baseKey = await crypto.subtle.importKey('raw', sigBytes.slice(0, 32), 'HKDF', false, [
    'deriveKey',
  ]);

  const info = new TextEncoder().encode(`gitlike-repo-key-${repoId}-epoch-${epoch}`);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
    baseKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

// ---------------------------------------------------------------------------
// Repo Key Generation & Wrapping
// ---------------------------------------------------------------------------

/** Generate a random 256-bit AES-GCM repo key. */
export async function generateRepoKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Wrap (encrypt) a repo key with a UEK using AES-KW. Returns base64 string. */
export async function wrapRepoKey(uek: CryptoKey, repoKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', repoKey, uek, 'AES-KW');
  return bufferToBase64(wrapped);
}

/** Unwrap (decrypt) a repo key from a base64-encoded wrapped key using AES-KW. */
export async function unwrapRepoKey(uek: CryptoKey, wrappedB64: string): Promise<CryptoKey> {
  const wrapped = base64ToBuffer(wrappedB64);
  return crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    uek,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** Export a CryptoKey to raw bytes (for caching). */
export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

/** Import raw bytes as an AES-GCM CryptoKey. */
export async function importRepoKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

// ---------------------------------------------------------------------------
// Content Encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

/** Encrypt plaintext with AES-256-GCM. Returns `iv || ciphertext` as one buffer. */
export async function encrypt(repoKey: CryptoKey, plaintext: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, repoKey, plaintext);
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result.buffer;
}

/** Decrypt an `iv || ciphertext` buffer with AES-256-GCM. */
export async function decrypt(repoKey: CryptoKey, encrypted: ArrayBuffer): Promise<ArrayBuffer> {
  const data = new Uint8Array(encrypted);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, repoKey, ciphertext);
}

/** Encrypt a string. Returns base64-encoded ciphertext. */
export async function encryptString(repoKey: CryptoKey, str: string): Promise<string> {
  const plaintext = new TextEncoder().encode(str);
  const encrypted = await encrypt(repoKey, plaintext.buffer);
  return bufferToBase64(encrypted);
}

/** Decrypt a base64-encoded ciphertext to a string. */
export async function decryptString(repoKey: CryptoKey, b64: string): Promise<string> {
  const encrypted = base64ToBuffer(b64);
  const plaintext = await decrypt(repoKey, encrypted);
  return new TextDecoder().decode(plaintext);
}

// ---------------------------------------------------------------------------
// Streaming Chunked Encryption
// ---------------------------------------------------------------------------

/** Whether a file should use streaming encryption based on size. */
export function shouldStream(size: number): boolean {
  return size > STREAM_THRESHOLD;
}

/**
 * Encrypt a ReadableStream in chunks.
 * Format: for each chunk, writes [4-byte LE length][IV + ciphertext].
 */
export function encryptStream(
  repoKey: CryptoKey,
  readable: ReadableStream<Uint8Array>,
  chunkSize = CHUNK_SIZE,
): ReadableStream<Uint8Array> {
  const reader = readable.getReader();
  let buffer = new Uint8Array(0);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (buffer.length < chunkSize) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer);
        combined.set(value, buffer.length);
        buffer = combined;
      }

      if (buffer.length === 0) {
        controller.close();
        return;
      }

      const chunk = buffer.slice(0, chunkSize);
      buffer = buffer.slice(chunkSize);

      const encrypted = await encrypt(repoKey, chunk.buffer);
      const encBytes = new Uint8Array(encrypted);

      // Write 4-byte LE length header + encrypted data
      const frame = new Uint8Array(4 + encBytes.length);
      new DataView(frame.buffer).setUint32(0, encBytes.length, true);
      frame.set(encBytes, 4);
      controller.enqueue(frame);
    },
  });
}

/**
 * Decrypt a chunked encrypted stream.
 * Reads [4-byte LE length][IV + ciphertext] frames.
 */
export function decryptStream(
  repoKey: CryptoKey,
  readable: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = readable.getReader();
  let buffer = new Uint8Array(0);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Accumulate until we have at least 4 bytes for the length header
      while (buffer.length < 4) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.length === 0) {
            controller.close();
            return;
          }
          throw new Error('Unexpected end of encrypted stream.');
        }
        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer);
        combined.set(value, buffer.length);
        buffer = combined;
      }

      const frameLen = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, true);

      // Accumulate until we have the full frame
      while (buffer.length < 4 + frameLen) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Unexpected end of encrypted stream.');
        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer);
        combined.set(value, buffer.length);
        buffer = combined;
      }

      const frame = buffer.slice(4, 4 + frameLen);
      buffer = buffer.slice(4 + frameLen);

      const decrypted = await decrypt(repoKey, frame.buffer);
      controller.enqueue(new Uint8Array(decrypted));
    },
  });
}

// ---------------------------------------------------------------------------
// Repo Key Cache (sessionStorage)
// ---------------------------------------------------------------------------

/** Cache an unwrapped repo key in sessionStorage. */
export async function cacheRepoKey(
  repoId: GroupId,
  epoch: number,
  repoKey: CryptoKey,
): Promise<void> {
  const raw = await exportKey(repoKey);
  const b64 = bufferToBase64(raw);
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${repoId}:${epoch}`, b64);
  } catch {
    // sessionStorage may be unavailable (e.g. private browsing limits)
  }
}

/** Retrieve a cached repo key from sessionStorage. */
export async function getCachedRepoKey(repoId: GroupId, epoch: number): Promise<CryptoKey | null> {
  try {
    const b64 = sessionStorage.getItem(`${CACHE_PREFIX}${repoId}:${epoch}`);
    if (!b64) return null;
    const raw = base64ToBuffer(b64);
    return importRepoKey(raw);
  } catch {
    return null;
  }
}

/** Clear all cached repo keys for a repo. */
export function clearCachedRepoKeys(repoId: GroupId): void {
  try {
    const prefix = `${CACHE_PREFIX}${repoId}:`;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Key Bundle Operations
// ---------------------------------------------------------------------------

/**
 * Unlock the repo key for the current user.
 * Tries cache first, then unwraps from the key bundle.
 */
export async function unlockRepoKey(
  repoId: GroupId,
  keyBundle: KeyBundle,
  epoch: number,
  address: Address,
  deriveUEKFn: (epoch: number) => Promise<CryptoKey>,
): Promise<CryptoKey> {
  // Try cache first
  const cached = await getCachedRepoKey(repoId, epoch);
  if (cached) return cached;

  const epochData = keyBundle[epoch];
  if (!epochData) throw new Error(`Key epoch ${epoch} not found in bundle.`);

  const wrappedB64 =
    epochData.wrappedKeys[address.toLowerCase() as Address] ?? epochData.wrappedKeys[address];
  if (!wrappedB64) throw new Error('No key found for your address in this repo.');

  const uek = await deriveUEKFn(epoch);
  const repoKey = await unwrapRepoKey(uek, wrappedB64);

  // Cache for future use
  await cacheRepoKey(repoId, epoch, repoKey);

  return repoKey;
}

/**
 * Create a new key bundle epoch.
 * Generates a fresh repo key and wraps it for each authorized address.
 */
export async function createKeyBundleEpoch(
  epoch: number,
  ownerPublicKey: string,
  authorizedAddresses: Address[],
  deriveUEKForAddress: (address: Address, epoch: number) => Promise<CryptoKey>,
): Promise<{ epochData: KeyBundleEpoch; repoKey: CryptoKey }> {
  const repoKey = await generateRepoKey();

  const wrappedKeys: Record<Address, string> = {} as Record<Address, string>;
  for (const addr of authorizedAddresses) {
    const uek = await deriveUEKForAddress(addr, epoch);
    wrappedKeys[addr] = await wrapRepoKey(uek, repoKey);
  }

  const epochData: KeyBundleEpoch = {
    ownerPublicKey,
    wrappedKeys,
    createdAt: new Date().toISOString(),
  };

  return { epochData, repoKey };
}

/**
 * Rotate the repo key (new epoch) after a collaborator is removed.
 * Preserves old epochs for historical data access.
 */
export async function rotateRepoKey(
  existingBundle: KeyBundle,
  ownerPublicKey: string,
  remainingAddresses: Address[],
  deriveUEKForAddress: (address: Address, epoch: number) => Promise<CryptoKey>,
): Promise<{ updatedBundle: KeyBundle; newEpoch: number; repoKey: CryptoKey }> {
  const existingEpochs = Object.keys(existingBundle).map(Number);
  const newEpoch = Math.max(...existingEpochs, 0) + 1;

  const { epochData, repoKey } = await createKeyBundleEpoch(
    newEpoch,
    ownerPublicKey,
    remainingAddresses,
    deriveUEKForAddress,
  );

  const updatedBundle: KeyBundle = { ...existingBundle, [newEpoch]: epochData };

  return { updatedBundle, newEpoch, repoKey };
}

// ---------------------------------------------------------------------------
// File Encryption Helpers
// ---------------------------------------------------------------------------

/** Encrypt a File object. Returns a new File with encrypted contents. */
export async function encryptFile(repoKey: CryptoKey, file: File): Promise<File> {
  const buffer = await file.arrayBuffer();

  let encryptedBuffer: ArrayBuffer;
  if (shouldStream(buffer.byteLength)) {
    // Stream-encrypt large files
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
    const encryptedStream = encryptStream(repoKey, stream);
    const reader = encryptedStream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    encryptedBuffer = combined.buffer;
  } else {
    encryptedBuffer = await encrypt(repoKey, buffer);
  }

  return new File([encryptedBuffer], file.name, { type: 'application/octet-stream' });
}

/** Decrypt raw encrypted bytes back to an ArrayBuffer. */
export async function decryptBlob(
  repoKey: CryptoKey,
  encrypted: ArrayBuffer,
  isStreamed: boolean,
): Promise<ArrayBuffer> {
  if (!isStreamed) {
    return decrypt(repoKey, encrypted);
  }

  // Stream-decrypt
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(encrypted));
      controller.close();
    },
  });
  const decryptedStream = decryptStream(repoKey, stream);
  const reader = decryptedStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined.buffer;
}

// ---------------------------------------------------------------------------
// Utility: hex, base64, PKCS8
// ---------------------------------------------------------------------------

/** Convert a hex string (with or without 0x prefix) to Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode an ArrayBuffer to base64. */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string to an ArrayBuffer. */
export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Build a minimal PKCS#8 wrapper for a raw P-256 private key.
 * Web Crypto requires PKCS#8 format for ECDH private key import.
 */
function buildPkcs8(rawPrivateKey: Uint8Array): ArrayBuffer {
  // PKCS#8 header for P-256/prime256v1 ECDH key
  const header = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const result = new Uint8Array(header.length + rawPrivateKey.length);
  result.set(header);
  result.set(rawPrivateKey, header.length);
  return result.buffer;
}
