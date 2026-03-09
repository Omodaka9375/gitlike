// ---------------------------------------------------------------------------
// GitLike — Pinata Storage Provider
// Implements StorageProvider using the Pinata SDK.
// ---------------------------------------------------------------------------

import { PinataSDK } from 'pinata';
import type { Env } from './env.js';
import type { StorageProvider, UploadResult, StorageUsage } from './storage.js';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Create a Pinata-backed storage provider. */
export function createPinataProvider(env: Env): StorageProvider {
  const sdk = new PinataSDK({
    pinataJwt: env.PINATA_JWT,
    pinataGateway: env.PINATA_GATEWAY || undefined,
  });

  const gateway = env.PINATA_GATEWAY || 'gateway.pinata.cloud';

  return {
    name: 'pinata',

    async createRepo(name: string): Promise<string> {
      const group = await sdk.groups.public.create({ name });
      return group.id;
    },

    async deleteRepo(repoId: string): Promise<void> {
      try {
        await sdk.groups.public.delete({ groupId: repoId });
      } catch {
        // Best-effort
      }
    },

    async uploadJSON(
      data: unknown,
      repo: string,
      meta?: Record<string, string>,
    ): Promise<UploadResult> {
      const typeName = (data as { type?: string })?.type ?? 'unknown';
      const kv: Record<string, string> = { type: typeName, repo, ...meta };
      const result = await sdk.upload.public
        .json(data as object)
        .group(repo)
        .keyvalues(kv)
        .name(`${typeName}.json`);
      return { cid: result.cid };
    },

    async uploadBlob(file: File, repo: string, name?: string): Promise<UploadResult> {
      let builder = sdk.upload.public.file(file).group(repo).keyvalues({ type: 'blob', repo });
      if (name) builder = builder.name(name);
      const result = await builder;
      return { cid: result.cid };
    },

    async unpin(cid: string): Promise<void> {
      try {
        const items = await sdk.files.public.list().cid(cid).limit(1).all();
        if (items.length > 0) {
          await sdk.files.public.delete([items[0].id]);
        }
      } catch {
        // Best-effort
      }
    },

    async presignUpload(repo: string, expires = 300): Promise<string> {
      return sdk.upload.public.createSignedURL({ expires, groupId: repo });
    },

    gatewayUrl(cid: string, path?: string): string {
      const base = `https://${gateway}/ipfs/${cid}`;
      return path ? `${base}/${path}` : base;
    },

    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`https://${gateway}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        return res.status !== 0;
      } catch {
        return false;
      }
    },

    async getUsage(): Promise<StorageUsage> {
      // Try v1 legacy endpoint first
      try {
        const res = await fetch('https://api.pinata.cloud/data/userPinnedDataTotal', {
          headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            pin_count: number;
            pin_size_total: number;
          };
          return { storageBytes: data.pin_size_total, fileCount: data.pin_count };
        }
      } catch {
        // Fall through
      }

      // Fallback: walk v3 file list
      const files = await sdk.files.public.list().limit(1000).all();
      const storageBytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
      return { storageBytes, fileCount: files.length };
    },
  };
}
