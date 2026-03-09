// ---------------------------------------------------------------------------
// GitLike — Storage Provider Abstraction
// Defines the interface for IPFS storage backends (Pinata, Filebase, etc.)
// ---------------------------------------------------------------------------

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an upload operation — always returns the IPFS CID. */
export type UploadResult = { cid: string };

/** Usage statistics from the storage provider. */
export type StorageUsage = { storageBytes: number; fileCount: number };

/**
 * Abstract IPFS storage provider.
 * Implementations exist for Pinata and Filebase.
 */
export type StorageProvider = {
  /** Provider name for logging/display. */
  readonly name: string;

  /** Create a new storage group for a repo. Returns a unique repo/group ID. */
  createRepo(name: string): Promise<string>;

  /** Delete a storage group. Best-effort — never throws. */
  deleteRepo(repoId: string): Promise<void>;

  /** Upload a JSON object to IPFS. Returns the CID. */
  uploadJSON(data: unknown, repo: string, meta?: Record<string, string>): Promise<UploadResult>;

  /** Upload a binary file to IPFS. Returns the CID. */
  uploadBlob(file: File, repo: string, name?: string): Promise<UploadResult>;

  /** Unpin a CID from the provider. Best-effort — never throws. */
  unpin(cid: string): Promise<void>;

  /** Generate a presigned upload URL for client-side uploads. */
  presignUpload(repo: string, expires?: number): Promise<string>;

  /** Build a gateway URL for a CID. */
  gatewayUrl(cid: string, path?: string): string;

  /** Check if the provider is reachable. */
  healthCheck(): Promise<boolean>;

  /** Fetch storage usage stats. */
  getUsage(): Promise<StorageUsage>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { createPinataProvider } from './storage-pinata.js';
import { createFilebaseProvider } from './storage-filebase.js';

/**
 * Create the appropriate storage provider based on env config.
 * Defaults to Pinata. When both Pinata and Filebase credentials are
 * present, uploads are mirrored to Filebase for redundancy.
 */
export function createStorage(env: Env): StorageProvider {
  const explicit = (env.STORAGE_PROVIDER ?? 'pinata').toLowerCase();

  if (explicit === 'filebase') {
    return createFilebaseProvider(env);
  }

  const primary = createPinataProvider(env);

  // Auto-mirror to Filebase when credentials are available
  if (env.FILEBASE_TOKEN && env.FILEBASE_BUCKET) {
    const mirror = createFilebaseProvider(env);
    return createMirroredProvider(primary, mirror);
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Mirrored provider — writes to primary, mirrors to secondary (best-effort)
// ---------------------------------------------------------------------------

/** Wrap a primary provider with a best-effort mirror for write operations. */
function createMirroredProvider(
  primary: StorageProvider,
  mirror: StorageProvider,
): StorageProvider {
  return {
    name: `${primary.name}+${mirror.name}`,

    createRepo: (name) => primary.createRepo(name),
    deleteRepo: (repoId) => primary.deleteRepo(repoId),
    presignUpload: (repo, expires) => primary.presignUpload(repo, expires),
    gatewayUrl: (cid, path) => primary.gatewayUrl(cid, path),
    healthCheck: () => primary.healthCheck(),
    getUsage: () => primary.getUsage(),

    async uploadJSON(data, repo, meta) {
      const result = await primary.uploadJSON(data, repo, meta);
      // Fire-and-forget mirror
      mirror.uploadJSON(data, repo, meta).catch(() => {});
      return result;
    },

    async uploadBlob(file, repo, name) {
      const result = await primary.uploadBlob(file, repo, name);
      // Fire-and-forget mirror
      mirror.uploadBlob(file, repo, name).catch(() => {});
      return result;
    },

    async unpin(cid) {
      await primary.unpin(cid);
      mirror.unpin(cid).catch(() => {});
    },
  };
}
