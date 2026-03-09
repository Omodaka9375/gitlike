// ---------------------------------------------------------------------------
// GitLike — Filebase Storage Provider
// Implements StorageProvider using Filebase's IPFS RPC API + S3-compat API.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';
import type { StorageProvider, UploadResult, StorageUsage } from './storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILEBASE_RPC = 'https://api.filebase.io/v0';
const FILEBASE_S3 = 'https://s3.filebase.com';
const FILEBASE_GATEWAY = 'https://ipfs.filebase.io';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Create a Filebase-backed storage provider. */
export function createFilebaseProvider(env: Env): StorageProvider {
  const token = env.FILEBASE_TOKEN!;
  const bucket = env.FILEBASE_BUCKET!;
  const gateway = env.FILEBASE_GATEWAY || FILEBASE_GATEWAY;

  /** Common auth header for IPFS RPC API. */
  const rpcHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
  });

  return {
    name: 'filebase',

    async createRepo(_name: string): Promise<string> {
      // Filebase has no group concept — generate a UUID
      return crypto.randomUUID();
    },

    async deleteRepo(_repoId: string): Promise<void> {
      // No-op — KV handles repo tracking; nothing to delete on Filebase
    },

    async uploadJSON(
      data: unknown,
      _repo: string,
      _meta?: Record<string, string>,
    ): Promise<UploadResult> {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const typeName = (data as { type?: string })?.type ?? 'data';
      const form = new FormData();
      form.append('file', blob, `${typeName}.json`);

      const res = await fetch(`${FILEBASE_RPC}/add?cid-version=1`, {
        method: 'POST',
        headers: rpcHeaders(),
        body: form,
      });

      if (!res.ok) {
        throw new Error(
          `Filebase upload failed: ${res.status} ${await res.text().catch(() => '')}`,
        );
      }

      const result = (await res.json()) as { Hash: string; Name: string; Size: string };
      return { cid: result.Hash };
    },

    async uploadBlob(file: File, _repo: string, name?: string): Promise<UploadResult> {
      const form = new FormData();
      form.append('file', file, name || file.name);

      const res = await fetch(`${FILEBASE_RPC}/add?cid-version=1`, {
        method: 'POST',
        headers: rpcHeaders(),
        body: form,
      });

      if (!res.ok) {
        throw new Error(
          `Filebase upload failed: ${res.status} ${await res.text().catch(() => '')}`,
        );
      }

      const result = (await res.json()) as { Hash: string; Name: string; Size: string };
      return { cid: result.Hash };
    },

    async unpin(cid: string): Promise<void> {
      try {
        await fetch(`${FILEBASE_RPC}/pin/rm?arg=${cid}`, {
          method: 'POST',
          headers: rpcHeaders(),
        });
      } catch {
        // Best-effort
      }
    },

    async presignUpload(repo: string, expires = 300): Promise<string> {
      // Generate an S3 presigned PutObject URL using HMAC-SHA256
      // Requires FILEBASE_KEY and FILEBASE_SECRET in env
      const key = env.FILEBASE_KEY;
      const secret = env.FILEBASE_SECRET;
      if (!key || !secret) {
        throw new Error(
          'Filebase S3 credentials (FILEBASE_KEY/FILEBASE_SECRET) required for presigned URLs.',
        );
      }

      const objectKey = `${repo}/${crypto.randomUUID()}`;
      const now = new Date();
      const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
      const amzDate = `${dateStamp}T${now.toISOString().replace(/[-:]/g, '').slice(9, 15)}Z`;
      const region = 'us-east-1';
      const service = 's3';
      const credential = `${key}/${dateStamp}/${region}/${service}/aws4_request`;

      // Build canonical query string for presigned URL
      const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': credential,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expires),
        'X-Amz-SignedHeaders': 'host',
      });

      const canonicalRequest = [
        'PUT',
        `/${bucket}/${objectKey}`,
        params.toString(),
        `host:s3.filebase.com\n`,
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n');

      const enc = new TextEncoder();

      // HMAC-SHA256 helper
      async function hmacSha256(keyData: ArrayBuffer, message: string): Promise<ArrayBuffer> {
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
      }

      async function sha256(data: string): Promise<string> {
        const hash = await crypto.subtle.digest('SHA-256', enc.encode(data));
        return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }

      const canonicalHash = await sha256(canonicalRequest);
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${dateStamp}/${region}/${service}/aws4_request\n${canonicalHash}`;

      let signingKey = await hmacSha256(
        enc.encode(`AWS4${secret}`).buffer as ArrayBuffer,
        dateStamp,
      );
      signingKey = await hmacSha256(signingKey, region);
      signingKey = await hmacSha256(signingKey, service);
      signingKey = await hmacSha256(signingKey, 'aws4_request');

      const signatureBytes = new Uint8Array(await hmacSha256(signingKey, stringToSign));
      const signature = [...signatureBytes].map((b) => b.toString(16).padStart(2, '0')).join('');

      params.set('X-Amz-Signature', signature);
      return `${FILEBASE_S3}/${bucket}/${objectKey}?${params.toString()}`;
    },

    gatewayUrl(cid: string, path?: string): string {
      const base = `${gateway}/ipfs/${cid}`;
      return path ? `${base}/${path}` : base;
    },

    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${FILEBASE_RPC}/version`, {
          headers: rpcHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async getUsage(): Promise<StorageUsage> {
      // Use IPFS RPC pin/ls to get a rough count
      try {
        const res = await fetch(`${FILEBASE_RPC}/pin/ls?type=recursive`, {
          headers: rpcHeaders(),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = (await res.json()) as { Keys: Record<string, { Type: string }> };
          const count = Object.keys(data.Keys ?? {}).length;
          // Filebase RPC doesn't return size per pin — report count only
          return { storageBytes: 0, fileCount: count };
        }
      } catch {
        // Fall through
      }
      return { storageBytes: 0, fileCount: 0 };
    },
  };
}
