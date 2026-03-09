// ---------------------------------------------------------------------------
// GitLike CLI — API Client
// HTTP client for the GitLike Worker API.
// ---------------------------------------------------------------------------

import { readGlobalConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types (mirrors src/types.ts — kept standalone to avoid cross-package imports)
// ---------------------------------------------------------------------------

export type Tree = {
  type: 'tree';
  entries: Array<{ name: string; cid: string; kind: 'blob' | 'tree'; size?: number }>;
};

export type Commit = {
  type: 'commit';
  tree: string;
  parents: string[];
  author: string;
  authorName?: string;
  timestamp: string;
  message: string;
  delegation?: string | null;
};

export type Manifest = {
  type: 'manifest';
  name: string;
  description: string;
  defaultBranch: string;
  branches: Record<string, string>;
  tags?: Record<string, string>;
  acl: { owners: string[]; writers: string[]; agents?: Record<string, unknown[]> };
  visibility?: 'public' | 'private';
  version?: number;
};

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

function getBase(): string {
  return readGlobalConfig().apiUrl || 'https://gitlike.dev';
}

function getToken(): string {
  return readGlobalConfig().token || '';
}

async function apiFetch(path: string, init: RequestInit = {}, auth = false): Promise<Response> {
  const url = `${getBase()}/api${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  const token = getToken();
  if (auth || token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if ((body as { error?: string }).error) msg = (body as { error: string }).error;
    } catch {
      // No JSON body
    }
    throw new Error(msg);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Gateway reads (proxied through our API)
// ---------------------------------------------------------------------------

export async function fetchJSON<T>(cid: string): Promise<T> {
  const base = getBase();
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/ipfs/${cid}`, { headers });
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchBytes(cid: string): Promise<Uint8Array> {
  const base = getBase();
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/ipfs/${cid}`, { headers });
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

export async function fetchManifest(groupId: string): Promise<Manifest | null> {
  try {
    const res = await apiFetch(`/repos/${groupId}/manifest`, {}, true);
    const data = await res.json();
    return (data as { manifest: Manifest | null }).manifest;
  } catch {
    return null;
  }
}

export async function getPresignedUrl(repoId: string): Promise<string> {
  const res = await apiFetch(`/repos/${repoId}/presign`, { method: 'POST' }, true);
  const data = await res.json();
  return (data as { url: string }).url;
}

export async function uploadFile(
  repoId: string,
  fileName: string,
  content: Uint8Array,
): Promise<{ cid: string; size: number }> {
  const presignedUrl = await getPresignedUrl(repoId);

  const blob = new Blob([content]);
  const formData = new FormData();
  formData.append('file', blob, fileName);

  const res = await fetch(presignedUrl, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  const d = data as { data: { cid: string; size?: number } };
  return { cid: d.data.cid, size: d.data.size ?? content.length };
}

export async function commitFiles(
  repoId: string,
  branch: string,
  message: string,
  files: Array<{ path: string; cid: string; size: number }>,
): Promise<{ commitCid: string; treeCid: string; manifestCid: string }> {
  const res = await apiFetch(
    `/repos/${repoId}/commit`,
    { method: 'POST', body: JSON.stringify({ branch, message, files }) },
    true,
  );
  return res.json() as Promise<{ commitCid: string; treeCid: string; manifestCid: string }>;
}

export async function createBranch(repoId: string, name: string, from: string): Promise<void> {
  await apiFetch(
    `/repos/${repoId}/branch`,
    { method: 'POST', body: JSON.stringify({ name, from }) },
    true,
  );
}

export async function listRepos(): Promise<Array<{ groupId: string; manifest: Manifest | null }>> {
  const res = await apiFetch('/repos?limit=100', {}, true);
  const data = await res.json();
  return (data as { repos: Array<{ groupId: string; manifest: Manifest | null }> }).repos;
}

export async function createRepo(
  name: string,
  description?: string,
  visibility?: 'public' | 'private',
  license?: string,
): Promise<{ groupId: string; manifestCid: string; commitCid: string }> {
  const res = await apiFetch(
    '/repos',
    { method: 'POST', body: JSON.stringify({ name, description, visibility, license }) },
    true,
  );
  return res.json() as Promise<{ groupId: string; manifestCid: string; commitCid: string }>;
}
