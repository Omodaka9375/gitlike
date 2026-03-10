// ---------------------------------------------------------------------------
// GitLike — IPFS Operations Layer
// Provider-agnostic functions for IPFS storage. Uses StorageProvider interface.
// Replaces the former pinata-server.ts.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';
import { createStorage } from './storage.js';
import type { StorageProvider, UploadResult } from './storage.js';

// ---------------------------------------------------------------------------
// Re-export storage types for consumer convenience
// ---------------------------------------------------------------------------

export { createStorage } from './storage.js';
export type { StorageProvider, UploadResult } from './storage.js';

// ---------------------------------------------------------------------------
// Domain types (unchanged from pinata-server.ts)
// ---------------------------------------------------------------------------

type CID = string;
type GroupId = string;
type ObjectType = 'tree' | 'commit' | 'manifest' | 'delegation';
type Address = `0x${string}`;

type Tree = {
  type: 'tree';
  entries: Array<{ name: string; cid: CID; kind: 'blob' | 'tree'; size?: number }>;
};
type Commit = {
  type: 'commit';
  tree: CID;
  parents: CID[];
  author: Address;
  authorName?: string;
  timestamp: string;
  message: string;
  delegation?: CID | null;
};
type Manifest = {
  type: 'manifest';
  name: string;
  description: string;
  defaultBranch: string;
  branches: Record<string, CID>;
  tags?: Record<string, CID>;
  pullRequests?: CID[];
  forkedFrom?: string;
  protectedBranches?: string[];
  acl: {
    owners: Address[];
    writers: Address[];
    agents: Record<
      string,
      Array<{ key: Address; scope: { actions: string[]; paths: string[] }; expires: string }>
    >;
  };
  visibility?: 'public' | 'private';
  license?: string;
  version?: number;
  pages?: { enabled: boolean; branch?: string; slug: string; spa?: boolean; folder?: string };
  encryption?: {
    enabled: boolean;
    algorithm: 'AES-256-GCM';
    currentEpoch: number;
    encryptTreeNames?: boolean;
  };
  keyBundle?: Record<
    number,
    {
      ownerPublicKey: string;
      wrappedKeys: Record<Address, string>;
      signature?: `0x${string}`;
      createdAt: string;
    }
  >;
  importedFrom?: string;
  issues?: CID[];
  issueCount?: number;
};
type IssueComment = {
  author: Address;
  body: string;
  createdAt: string;
};
type Issue = {
  type: 'issue';
  number: number;
  title: string;
  body: string;
  author: Address;
  status: 'open' | 'closed';
  labels: string[];
  comments: IssueComment[];
  createdAt: string;
  updatedAt: string;
};
type Delegation = {
  type: 'delegation';
  delegator: Address;
  agent: Address;
  repo: GroupId;
  scope: { actions: string[]; paths: string[] };
  expires: string;
  signature: `0x${string}`;
};
type PullRequest = {
  type: 'pullRequest';
  title: string;
  description: string;
  author: Address;
  sourceBranch: string;
  targetBranch: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  updatedAt: string;
};

export type {
  CID,
  GroupId,
  ObjectType,
  Address,
  Tree,
  Commit,
  Manifest,
  Delegation,
  PullRequest,
  Issue,
  IssueComment,
};

// ---------------------------------------------------------------------------
// Upload wrappers (thin delegates to StorageProvider)
// ---------------------------------------------------------------------------

/** Upload a JSON object to IPFS. */
export async function pinJSON<
  T extends Tree | Commit | Manifest | Delegation | PullRequest | Issue,
>(
  provider: StorageProvider,
  data: T,
  repo: GroupId,
  extraMeta: Record<string, string> = {},
): Promise<UploadResult> {
  return provider.uploadJSON(data, repo, extraMeta);
}

/** Upload a binary file to IPFS. */
export async function pinBlob(
  provider: StorageProvider,
  file: File,
  repo: GroupId,
  name?: string,
): Promise<UploadResult> {
  return provider.uploadBlob(file, repo, name);
}

/** Create a presigned upload URL. */
export async function createPresignedUrl(
  provider: StorageProvider,
  repo: GroupId,
  expires = 300,
): Promise<string> {
  return provider.presignUpload(repo, expires);
}

// ---------------------------------------------------------------------------
// Gateway reads — with fallback
// ---------------------------------------------------------------------------

/** Build the list of gateway URLs to try for a CID. */
function buildGatewayUrls(env: Env, cid: string): string[] {
  const provider = createStorage(env);
  const urls = [provider.gatewayUrl(cid)];

  // Add Pinata gateway as fallback if using Filebase (and vice versa)
  if (env.PINATA_GATEWAY && provider.name !== 'pinata') {
    urls.push(`https://${env.PINATA_GATEWAY}/ipfs/${cid}`);
  }
  if (env.FILEBASE_GATEWAY && provider.name !== 'filebase') {
    urls.push(`${env.FILEBASE_GATEWAY}/ipfs/${cid}`);
  }

  // Additional fallback gateways
  if (env.FALLBACK_GATEWAYS) {
    for (const gw of env.FALLBACK_GATEWAYS.split(',')) {
      const domain = gw.trim();
      if (domain) urls.push(`https://${domain}/ipfs/${cid}`);
    }
  }

  return urls;
}

/** Build auth headers for a gateway URL. */
function gatewayHeaders(env: Env, url: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.PINATA_JWT && url.includes(env.PINATA_GATEWAY || 'gateway.pinata.cloud')) {
    headers['Authorization'] = `Bearer ${env.PINATA_JWT}`;
  }
  return headers;
}

/** Fetch JSON from IPFS by CID. Tries primary + fallback gateways. */
export async function fetchJSON<T>(env: Env, cid: CID): Promise<T> {
  const urls = buildGatewayUrls(env, cid);
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const headers = gatewayHeaders(env, url);
      const res = await fetch(url, { headers, cf: { cacheTtl: 300 } } as RequestInit);
      if (res.ok) return res.json() as Promise<T>;
      lastError = new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error(`Gateway fetch failed for ${cid}`);
}

/** Fetch raw bytes from IPFS by CID. Tries primary + fallback gateways. */
export async function fetchRaw(env: Env, cid: CID): Promise<Uint8Array> {
  const urls = buildGatewayUrls(env, cid);
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const headers = gatewayHeaders(env, url);
      const res = await fetch(url, { headers, cf: { cacheTtl: 300 } } as RequestInit);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      lastError = new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error(`Gateway fetch failed for ${cid}`);
}

/** Build a gateway URL for a CID using the primary provider. */
export function gatewayUrl(env: Env, cid: string, path = ''): string {
  const provider = createStorage(env);
  return provider.gatewayUrl(cid, path || undefined);
}

// ---------------------------------------------------------------------------
// Signatures — stored in KV (provider-agnostic)
// ---------------------------------------------------------------------------

/** Store a CID signature in KV. */
export async function storeCidSignature(
  env: Env,
  cid: CID,
  signature: `0x${string}`,
  address: Address,
): Promise<void> {
  await env.SESSIONS.put(`sig:${cid}`, JSON.stringify({ signature, address, ts: Date.now() }));
}

/** Read a CID signature from KV. Falls back to Pinata API for legacy sigs. */
export async function getCidSignature(
  env: Env,
  cid: CID,
): Promise<{ cid: string; signature: string | null }> {
  // Try KV first
  const raw = await env.SESSIONS.get(`sig:${cid}`);
  if (raw) {
    try {
      const data = JSON.parse(raw) as { signature: string };
      return { cid, signature: data.signature };
    } catch {
      // Malformed — fall through
    }
  }

  // Legacy fallback: try Pinata signatures API if JWT is available
  if (env.PINATA_JWT) {
    try {
      const { PinataSDK } = await import('pinata');
      const sdk = new PinataSDK({
        pinataJwt: env.PINATA_JWT,
        pinataGateway: env.PINATA_GATEWAY || undefined,
      });
      const result = await sdk.signatures.public.get(cid);
      return { cid: result.cid, signature: result.signature };
    } catch {
      // Not found in Pinata either
    }
  }

  return { cid, signature: null };
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

/** Fetch the latest manifest for a repo. Uses KV as authoritative source. */
export async function fetchManifest(
  _provider: StorageProvider,
  env: Env,
  repo: GroupId,
): Promise<Manifest | null> {
  const kvCid = await env.SESSIONS.get(`manifest:${repo}`);
  if (kvCid) {
    try {
      return await fetchJSON<Manifest>(env, kvCid);
    } catch {
      // KV entry is stale — no fallback (listByType removed)
    }
  }
  return null;
}

/** Store manifest CID in KV and unpin the previous one. */
export async function storeManifestCid(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  cid: CID,
): Promise<void> {
  const oldCid = await env.SESSIONS.get(`manifest:${repo}`);
  await env.SESSIONS.put(`manifest:${repo}`, cid);
  if (oldCid && oldCid !== cid) {
    provider.unpin(oldCid).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Commit history (gateway-only, provider-agnostic)
// ---------------------------------------------------------------------------

/** Entry in a commit walk. */
export type CommitEntry = { cid: CID; commit: Commit };

/** Walk commit history starting from a CID. */
export async function walkCommitHistory(
  env: Env,
  startCid: CID,
  depth = 50,
): Promise<CommitEntry[]> {
  const entries: CommitEntry[] = [];
  let current: CID | null = startCid;
  while (current && entries.length < depth) {
    const commit: Commit = await fetchJSON<Commit>(env, current);
    entries.push({ cid: current, commit });
    current = commit.parents.length > 0 ? commit.parents[0] : null;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Pruning (provider-agnostic)
// ---------------------------------------------------------------------------

/** Prune tree data beyond retention depth. Best-effort. */
export async function pruneOldSnapshots(
  provider: StorageProvider,
  env: Env,
  headCid: CID,
  depth: number,
): Promise<void> {
  if (depth <= 0) return;
  let current: CID | null = headCid;
  let idx = 0;
  while (current) {
    const commit: Commit = await fetchJSON<Commit>(env, current);
    idx++;
    if (idx > depth) {
      provider.unpin(commit.tree).catch(() => {});
    }
    current = commit.parents.length > 0 ? commit.parents[0] : null;
    if (idx > depth + 10) break;
  }
}
