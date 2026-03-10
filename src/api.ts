// ---------------------------------------------------------------------------
// GitLike — Frontend API Client
// Calls Worker backend for writes, Pinata gateway directly for reads.
// ---------------------------------------------------------------------------

import { gatewayUrl, MAX_LOG_DEPTH } from './config.js';
import type { CID, GroupId, Commit, Manifest, EncryptionConfig, KeyBundle } from './types.js';
import { shouldIgnore, parseGitignore } from './file-filter.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Base URL for the Worker API (same origin). */
const API_BASE = '/api';

/** Max retries for gateway reads. */
const MAX_RETRIES = 3;

/** Concurrent file uploads during import. */
const IMPORT_CONCURRENCY = 5;

/** Session token storage key. */
const SESSION_KEY = 'gitlike_session';

/** Session TTL in milliseconds (matches server's 24h). */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Max cached gateway responses (immutable content-addressed data). */
const CACHE_MAX = 500;

/** Manifest cache TTL in milliseconds. */
const MANIFEST_TTL = 15_000;

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

type StoredSession = { token: string; expiresAt: number };

/** Get the current session token. Returns null if missing or expired. */
export function getSessionToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: StoredSession = JSON.parse(raw);
    if (Date.now() >= session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session.token;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/** Store a session token with expiry. */
export function setSessionToken(token: string): void {
  const session: StoredSession = { token, expiresAt: Date.now() + SESSION_TTL_MS };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Clear the session token. */
export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Check if a session is active. */
export function hasSession(): boolean {
  return !!getSessionToken();
}

/** Validate the current session against the server. Clears token if invalid. */
export async function validateSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return true;
    clearSessionToken();
    return false;
  } catch {
    // Network error — assume still valid to avoid offline breakage
    return true;
  }
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

/** Request a nonce for SIWE signing. */
export async function fetchNonce(): Promise<string> {
  const res = await apiFetch('/auth/nonce', { method: 'POST' });
  const data = await res.json();
  return data.nonce;
}

/** Verify a SIWE message + signature, returns session token. */
export async function verifySignature(
  message: string,
  signature: string,
): Promise<{ token: string; address: string }> {
  const res = await apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  });
  const data = await res.json();
  setSessionToken(data.token);
  return data;
}

/** Log out and destroy the session. */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' }, true);
  } catch {
    // Best-effort
  }
  clearSessionToken();
}

// ---------------------------------------------------------------------------
// Repo API (writes → Worker, reads → gateway)
// ---------------------------------------------------------------------------

/** Repo summary from the list endpoint. */
export type RepoSummary = {
  groupId: GroupId;
  groupName: string;
  manifest: Manifest | null;
};

/** Paginated repo list response. */
export type RepoListResponse = {
  repos: RepoSummary[];
  nextOffset: number | null;
  total: number;
};

/** List repos with pagination. Sends auth so private repos are included. */
export async function listRepos(limit = 20, offset = 0): Promise<RepoListResponse> {
  const res = await apiFetch(`/repos?limit=${limit}&offset=${offset}`, {}, false, true);
  return res.json();
}

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _slugCache = new Map<string, string>();

/** Convert a repo name to a URL-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Resolve a slug (or UUID) to a groupId. UUIDs pass through directly. */
export async function resolveSlug(slug: string): Promise<GroupId> {
  if (UUID_RE.test(slug)) return slug as GroupId;
  const cached = _slugCache.get(slug);
  if (cached) return cached as GroupId;
  const res = await apiFetch(`/repos/resolve/${encodeURIComponent(slug)}`);
  const data = await res.json();
  _slugCache.set(slug, data.groupId);
  return data.groupId as GroupId;
}

/** License option returned by the licenses endpoint. */
export type LicenseOption = { id: string; name: string };

/** Fetch available license options (cached). */
let _licenseCache: LicenseOption[] | null = null;
export async function fetchLicenses(): Promise<LicenseOption[]> {
  if (_licenseCache) return _licenseCache;
  try {
    const res = await apiFetch('/repos/licenses');
    const data = await res.json();
    _licenseCache = (data as { licenses: LicenseOption[] }).licenses;
    return _licenseCache!;
  } catch {
    return [
      { id: 'NOL', name: 'Nuclear Option License v1.0 (NOL)' },
      { id: 'MIT', name: 'MIT License' },
      { id: 'Apache-2.0', name: 'Apache License 2.0' },
      { id: 'GPL-3.0', name: 'GNU GPL v3.0' },
      { id: 'BSD-2-Clause', name: 'BSD 2-Clause' },
      { id: 'none', name: 'No License' },
    ];
  }
}

/** Create a new repo. */
export async function createRepo(
  name: string,
  description?: string,
  visibility?: 'public' | 'private',
  license?: string,
): Promise<{ groupId: GroupId; manifestCid: CID; commitCid: CID }> {
  const res = await apiFetch(
    '/repos',
    {
      method: 'POST',
      body: JSON.stringify({ name, description, visibility, license }),
    },
    true,
  );
  return res.json();
}

/** Get a presigned upload URL for blob upload. */
export async function getPresignedUrl(repoId: GroupId): Promise<string> {
  const res = await apiFetch(`/repos/${repoId}/presign`, { method: 'POST' }, true);
  const data = await res.json();
  return data.url;
}

/** Upload a file via presigned URL with retry. Encrypts if repoKey is provided. */
export async function uploadFile(
  repoId: GroupId,
  file: File,
  repoKey?: CryptoKey,
): Promise<{ cid: CID; size: number }> {
  return withRetry(async () => {
    const presignedUrl = await getPresignedUrl(repoId);

    let uploadFile = file;
    if (repoKey) {
      const { encryptFile } = await import('./encryption.js');
      uploadFile = await encryptFile(repoKey, file);
    }

    const formData = new FormData();
    formData.append('file', uploadFile, uploadFile.name);

    const res = await fetch(presignedUrl, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json();
    return { cid: data.data.cid, size: data.data.size ?? file.size };
  });
}

/** Stage multiple files by uploading them in parallel. Encrypts if repoKey is provided. */
export async function stageFiles(
  repoId: GroupId,
  files: File[],
  paths: string[],
  repoKey?: CryptoKey,
): Promise<Array<{ path: string; cid: CID; size: number }>> {
  const limit = createConcurrencyLimiter(IMPORT_CONCURRENCY);
  const staged: Array<{ path: string; cid: CID; size: number }> = [];

  // If encryption is enabled and tree names should be encrypted, encrypt paths
  let encryptedPaths = paths;
  if (repoKey) {
    const { encryptString } = await import('./encryption.js');
    encryptedPaths = await Promise.all(paths.map((p) => encryptString(repoKey, p)));
  }

  const tasks = files.map((file, i) =>
    limit(async () => {
      const { cid, size } = await uploadFile(repoId, file, repoKey);
      staged.push({ path: encryptedPaths[i], cid, size });
    }),
  );

  await Promise.all(tasks);
  return staged;
}

/** Create a commit. */
export async function commitFiles(
  repoId: GroupId,
  branch: string,
  message: string,
  files: Array<{ path: string; cid: CID; size: number; deleted?: boolean }>,
  signature?: string,
): Promise<{ commitCid: CID; treeCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({ branch, message, files, signature }),
    },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Create a new branch. */
export async function createBranch(
  repoId: GroupId,
  name: string,
  from: string,
): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/branch`,
    {
      method: 'POST',
      body: JSON.stringify({ name, from }),
    },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Delete a branch. */
export async function deleteBranch(repoId: GroupId, name: string): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/branch/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Merge a source branch into a target branch. */
export async function mergeBranches(
  repoId: GroupId,
  source: string,
  target: string,
  message?: string,
  signature?: string,
): Promise<{ commitCid: CID; treeCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/merge`,
    {
      method: 'POST',
      body: JSON.stringify({ source, target, message, signature }),
    },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Update repo settings (owner only). */
export async function updateSettings(
  repoId: GroupId,
  settings: {
    name?: string;
    description?: string;
    writers?: string[];
    protectedBranches?: string[];
    visibility?: 'public' | 'private';
    importedFrom?: string;
    encryption?: EncryptionConfig;
    keyBundle?: KeyBundle;
  },
): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/settings`,
    { method: 'POST', body: JSON.stringify(settings) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Delete a repo (owner only). */
export async function deleteRepo(repoId: GroupId): Promise<void> {
  await apiFetch(`/repos/${repoId}`, { method: 'DELETE' }, true);
  invalidateManifest(repoId);
}

/** Create a tag. */
export async function createTag(
  repoId: GroupId,
  name: string,
  target: CID,
): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/tag/${encodeURIComponent(name)}`,
    { method: 'POST', body: JSON.stringify({ target }) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Delete a tag. */
export async function deleteTag(repoId: GroupId, name: string): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/tag/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Fork a repo. */
export async function forkRepo(repoId: GroupId): Promise<{ groupId: GroupId; manifestCid: CID }> {
  const res = await apiFetch(`/repos/${repoId}/fork`, { method: 'POST' }, true);
  invalidateManifest(repoId);
  return res.json();
}

/** Create a pull request. */
export async function createPR(
  repoId: GroupId,
  title: string,
  sourceBranch: string,
  targetBranch: string,
  description?: string,
): Promise<{ prCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/pr`,
    { method: 'POST', body: JSON.stringify({ title, description, sourceBranch, targetBranch }) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Update a PR status. */
export async function updatePR(
  repoId: GroupId,
  prCid: CID,
  status: 'open' | 'merged' | 'closed',
): Promise<{ prCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/pr/${prCid}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** List pull requests for a repo. */
export async function listPRs(repoId: GroupId): Promise<{
  prs: Array<{
    cid: CID;
    pr: {
      title: string;
      description: string;
      author: string;
      sourceBranch: string;
      targetBranch: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    };
  }>;
}> {
  const res = await apiFetch(`/repos/${repoId}/prs`);
  return res.json();
}

/** Create an issue. */
export async function createIssue(
  repoId: GroupId,
  title: string,
  body?: string,
  labels?: string[],
): Promise<{ issueCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/issues`,
    { method: 'POST', body: JSON.stringify({ title, body, labels }) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Update an issue (comment, close/reopen, labels). */
export async function updateIssue(
  repoId: GroupId,
  issueCid: CID,
  update: { status?: 'open' | 'closed'; comment?: string; labels?: string[] },
): Promise<{ issueCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/issues/${issueCid}`,
    { method: 'PATCH', body: JSON.stringify(update) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** List issues for a repo. */
export async function listIssues(repoId: GroupId): Promise<{
  issues: Array<{
    cid: CID;
    issue: {
      number: number;
      title: string;
      body: string;
      author: string;
      status: string;
      labels: string[];
      comments: Array<{ author: string; body: string; createdAt: string }>;
      createdAt: string;
      updatedAt: string;
    };
  }>;
}> {
  const res = await apiFetch(`/repos/${repoId}/issues`);
  return res.json();
}

/** Create a delegation. */
export async function createDelegation(
  repoId: GroupId,
  agent: string,
  scope: { actions: string[]; paths: string[] },
  signature: string,
  expiresInMs?: number,
): Promise<{ delegationCid: CID; manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/delegation`,
    {
      method: 'POST',
      body: JSON.stringify({ agent, scope, signature, expiresInMs }),
    },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

/** Revoke a delegation. */
export async function revokeDelegation(
  repoId: GroupId,
  agent: string,
): Promise<{ manifestCid: CID }> {
  const res = await apiFetch(
    `/repos/${repoId}/delegation/${agent}`,
    {
      method: 'DELETE',
    },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

// ---------------------------------------------------------------------------
// Public key API (for encryption key exchange)
// ---------------------------------------------------------------------------

/** Fetch a user's stored public key. */
export async function fetchPubkey(address: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/pubkey/${address.toLowerCase()}`);
    const data = await res.json();
    return data.pubkey ?? null;
  } catch {
    return null;
  }
}

/** Store the current user's public key. */
export async function storePubkey(pubkey: string): Promise<void> {
  await apiFetch('/pubkey', { method: 'PUT', body: JSON.stringify({ pubkey }) }, true);
}

// ---------------------------------------------------------------------------
// Gateway reads (direct, no Worker needed)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Gateway cache — immutable content (keyed by CID) is cached forever
// ---------------------------------------------------------------------------

const _jsonCache = new Map<string, unknown>();
const _textCache = new Map<string, string>();

function cacheSet<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
}

/** Fetch JSON from IPFS gateway with retry and caching. */
export async function fetchJSON<T>(cid: CID): Promise<T> {
  const cached = _jsonCache.get(cid) as T | undefined;
  if (cached !== undefined) return cached;

  const url = gatewayUrl(cid);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  const data = (await res.json()) as T;
  cacheSet(_jsonCache, cid, data);
  return data;
}

/** Fetch raw bytes from IPFS gateway with retry. */
export async function fetchBytes(cid: CID): Promise<Uint8Array> {
  const url = gatewayUrl(cid);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Gateway fetch failed for ${cid}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch text content from IPFS gateway with retry and caching. */
export async function fetchText(cid: CID, path = ''): Promise<string> {
  const key = path ? `${cid}/${path}` : cid;
  const cached = _textCache.get(key);
  if (cached !== undefined) return cached;

  const url = gatewayUrl(cid, path);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Gateway fetch failed: ${res.status}`);
  const text = await res.text();
  cacheSet(_textCache, key, text);
  return text;
}

// ---------------------------------------------------------------------------
// Manifest cache — short TTL, invalidated on writes
// ---------------------------------------------------------------------------

const _manifestCache = new Map<string, { manifest: Manifest; ts: number }>();

/** Invalidate the cached manifest for a repo. Call after any write. */
export function invalidateManifest(repoId: GroupId): void {
  _manifestCache.delete(repoId);
}

/** Fetch a manifest for a repo (cached with 15 s TTL). */
export async function fetchManifest(repoId: GroupId): Promise<Manifest | null> {
  const cached = _manifestCache.get(repoId);
  if (cached && Date.now() - cached.ts < MANIFEST_TTL) return cached.manifest;

  try {
    const res = await apiFetch(`/repos/${repoId}/manifest`, {}, false, true);
    const data = await res.json();
    const manifest = data.manifest as Manifest | null;
    if (manifest) _manifestCache.set(repoId, { manifest, ts: Date.now() });
    return manifest;
  } catch {
    return null;
  }
}

/** Resolve a branch to its HEAD commit CID. */
export async function resolveRef(repoId: GroupId, branch: string): Promise<CID | null> {
  const manifest = await fetchManifest(repoId);
  if (!manifest) return null;
  return manifest.branches[branch] ?? null;
}

/** Entry in the commit history with its CID. */
export type CommitEntry = { cid: CID; commit: Commit };

/** Register a signature for a CID via the worker. */
export async function registerSignature(
  repoId: GroupId,
  cid: CID,
  signature: string,
): Promise<void> {
  await apiFetch(
    `/repos/${repoId}/signature/${cid}`,
    { method: 'POST', body: JSON.stringify({ signature }) },
    true,
  );
}

/** Walk commit history from a starting CID. Returns commits with their CIDs. */
export async function walkCommitHistory(
  startCid: CID,
  depth = MAX_LOG_DEPTH,
): Promise<CommitEntry[]> {
  const entries: CommitEntry[] = [];
  let current: CID | null = startCid;
  while (current && entries.length < depth) {
    const commit: Commit = await fetchJSON<Commit>(current);
    entries.push({ cid: current, commit });
    current = commit.parents.length > 0 ? commit.parents[0] : null;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Repo Import (GitHub + GitLab via Worker presigned URLs)
// ---------------------------------------------------------------------------

/** Progress callback. */
export type ImportProgress = (message: string, done?: boolean) => void;

type RepoSource = {
  platform: 'github' | 'gitlab';
  owner: string;
  repo: string;
  branch?: string;
};

/** Parse a GitHub/GitLab URL. */
export function parseRepoUrl(url: string): RepoSource | null {
  const ghMatch = url.match(
    /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/i,
  );
  if (ghMatch) {
    return { platform: 'github', owner: ghMatch[1], repo: ghMatch[2], branch: ghMatch[3] };
  }
  const glMatch = url.match(
    /(?:https?:\/\/)?gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/-\/tree\/([^/]+))?(?:\/.*)?$/i,
  );
  if (glMatch) {
    return { platform: 'gitlab', owner: glMatch[1], repo: glMatch[2], branch: glMatch[3] };
  }
  return null;
}

/** Import a repo from GitHub or GitLab. Dispatches to platform-specific logic. */
export async function importFromGitHub(
  source: RepoSource,
  onProgress: ImportProgress = () => {},
): Promise<{ groupId: GroupId; manifestCid: CID }> {
  if (source.platform === 'gitlab') return importFromGitLab(source, onProgress);
  return importFromGitHubImpl(source, onProgress);
}

/** GitHub import implementation. */
async function importFromGitHubImpl(
  source: RepoSource,
  onProgress: ImportProgress,
): Promise<{ groupId: GroupId; manifestCid: CID }> {
  const branch = source.branch ?? (await detectGitHubDefaultBranch(source));
  onProgress(`Fetching tree for ${source.owner}/${source.repo}@${branch}...`);

  // Fetch recursive tree from GitHub API
  const treeRes = await fetch(
    `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${branch}?recursive=1`,
  );
  if (!treeRes.ok) throw new Error(`GitHub API error: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    truncated?: boolean;
  };

  if (treeData.truncated) {
    onProgress('Warning: tree is truncated. Large repos may be incomplete.');
  }

  const allBlobs = treeData.tree.filter((i) => i.type === 'blob');
  const blobs = await filterIgnored(
    allBlobs.map((i) => i.path),
    async () => {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${branch}/.gitignore`,
      );
      return raw.ok ? raw.text() : null;
    },
  );
  const blobSet = new Set(blobs);
  const filteredBlobs = allBlobs.filter((i) => blobSet.has(i.path));
  const skipped = allBlobs.length - filteredBlobs.length;
  if (skipped > 0) onProgress(`Filtered ${skipped} ignored file(s).`);

  return uploadAndCommit(
    source,
    filteredBlobs.map((i) => i.path),
    branch,
    (path) => `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${branch}/${path}`,
    onProgress,
  );
}

/** GitLab import implementation. */
async function importFromGitLab(
  source: RepoSource,
  onProgress: ImportProgress,
): Promise<{ groupId: GroupId; manifestCid: CID }> {
  const projectPath = encodeURIComponent(`${source.owner}/${source.repo}`);
  const branch = source.branch ?? (await detectGitLabDefaultBranch(projectPath));
  onProgress(`Fetching tree for ${source.owner}/${source.repo}@${branch}...`);

  // GitLab tree API is paginated — collect all pages
  const allPaths: string[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const treeRes = await fetch(
      `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`,
    );
    if (!treeRes.ok) throw new Error(`GitLab API error: ${treeRes.status}`);
    const items = (await treeRes.json()) as Array<{ path: string; type: string }>;
    for (const item of items) {
      if (item.type === 'blob') allPaths.push(item.path);
    }
    if (items.length < perPage) break;
    page++;
  }

  const blobs = await filterIgnored(allPaths, async () => {
    const raw = await fetch(
      `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent('.gitignore')}/raw?ref=${encodeURIComponent(branch)}`,
    );
    return raw.ok ? raw.text() : null;
  });
  const skipped = allPaths.length - blobs.length;
  if (skipped > 0) onProgress(`Filtered ${skipped} ignored file(s).`);

  return uploadAndCommit(
    source,
    blobs,
    branch,
    (path) =>
      `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`,
    onProgress,
  );
}

/** Shared upload + commit flow for both GitHub and GitLab imports. */
async function uploadAndCommit(
  source: RepoSource,
  paths: string[],
  branch: string,
  rawUrl: (path: string) => string,
  onProgress: ImportProgress,
): Promise<{ groupId: GroupId; manifestCid: CID }> {
  onProgress(`Found ${paths.length} files. Creating repo...`);

  const { groupId } = await createRepo(
    source.repo,
    `Imported from ${source.platform}:${source.owner}/${source.repo}`,
  );

  let uploaded = 0;
  const staged: Array<{ path: string; cid: CID; size: number }> = [];
  const limit = createConcurrencyLimiter(IMPORT_CONCURRENCY);

  const tasks = paths.map((filePath) =>
    limit(async () => {
      const rawRes = await fetch(rawUrl(filePath));
      if (!rawRes.ok) return;
      const content = await rawRes.arrayBuffer();
      const file = new File([content], filePath.split('/').pop() ?? 'file', {
        type: 'application/octet-stream',
      });

      const { cid, size } = await uploadFile(groupId, file);
      staged.push({ path: filePath, cid, size });

      uploaded++;
      if (uploaded % 10 === 0 || uploaded === paths.length) {
        onProgress(`Uploading file ${uploaded}/${paths.length}: ${filePath}`);
      }
    }),
  );

  await Promise.all(tasks);

  onProgress('Creating commit...');
  const { manifestCid } = await commitFiles(
    groupId,
    'main',
    `Import from ${source.platform}: ${source.owner}/${source.repo}@${branch}`,
    staged,
  );

  // Store upstream source in manifest for future syncing
  const importedFrom = `${source.platform}:${source.owner}/${source.repo}@${branch}`;
  await updateSettings(groupId, { importedFrom });

  onProgress(`\u2713 Imported ${staged.length} files!`, true);
  return { groupId, manifestCid };
}

/** Filter file paths using .gitignore rules fetched via the provided loader. */
async function filterIgnored(
  paths: string[],
  loadGitignore: () => Promise<string | null>,
): Promise<string[]> {
  const hasGitignore = paths.includes('.gitignore');
  let patterns: string[] = [];
  if (hasGitignore) {
    try {
      const text = await loadGitignore();
      if (text) patterns = parseGitignore(text);
    } catch {
      /* ignore */
    }
  }
  return paths.filter((p) => !shouldIgnore(p, patterns));
}

async function detectGitHubDefaultBranch(source: RepoSource): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${source.owner}/${source.repo}`);
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub API rate limit reached.');
  }
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch ?? 'main';
}

async function detectGitLabDefaultBranch(projectPath: string): Promise<string> {
  const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}`);
  if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch ?? 'main';
}

// ---------------------------------------------------------------------------
// Upstream Sync (pull updates from GitHub/GitLab)
// ---------------------------------------------------------------------------

/** Parse an importedFrom string like "github:owner/repo@branch". */
export function parseImportedFrom(
  value: string,
): { platform: 'github' | 'gitlab'; owner: string; repo: string; branch: string } | null {
  const m = value.match(/^(github|gitlab):([^/]+)\/([^@]+)@(.+)$/);
  if (!m) return null;
  return { platform: m[1] as 'github' | 'gitlab', owner: m[2], repo: m[3], branch: m[4] };
}

/** Walk a GitLike tree recursively and collect all file paths with sizes. */
async function collectTreeFiles(
  treeCid: CID,
  prefix = '',
): Promise<Map<string, { cid: CID; size: number }>> {
  const tree = await fetchJSON<{
    entries: Array<{ name: string; cid: CID; kind: string; size?: number }>;
  }>(treeCid);
  const files = new Map<string, { cid: CID; size: number }>();
  for (const e of tree.entries) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.kind === 'blob') {
      files.set(p, { cid: e.cid, size: e.size ?? 0 });
    } else {
      const sub = await collectTreeFiles(e.cid, p);
      for (const [k, v] of sub) files.set(k, v);
    }
  }
  return files;
}

/** Sync a repo from its upstream GitHub/GitLab source. */
export async function syncFromUpstream(
  repoId: GroupId,
  manifest: Manifest,
  onProgress: ImportProgress = () => {},
): Promise<{ commitCid: CID; added: number; updated: number; deleted: number }> {
  if (!manifest.importedFrom) throw new Error('Repo has no upstream source.');
  const source = parseImportedFrom(manifest.importedFrom);
  if (!source) throw new Error(`Invalid importedFrom: ${manifest.importedFrom}`);

  onProgress(`Fetching upstream tree from ${source.platform}...`);

  // 1. Fetch upstream file list with sizes
  type UpstreamBlob = { path: string; size: number };
  let upstreamBlobs: UpstreamBlob[];

  if (source.platform === 'github') {
    const treeRes = await fetch(
      `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`,
    );
    if (!treeRes.ok) throw new Error(`GitHub API error: ${treeRes.status}`);
    const data = (await treeRes.json()) as {
      tree: Array<{ path: string; type: string; size?: number }>;
    };
    upstreamBlobs = data.tree
      .filter((i) => i.type === 'blob')
      .map((i) => ({ path: i.path, size: i.size ?? 0 }));
  } else {
    const projectPath = encodeURIComponent(`${source.owner}/${source.repo}`);
    upstreamBlobs = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?recursive=true&ref=${encodeURIComponent(source.branch)}&per_page=100&page=${page}`,
      );
      if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
      const items = (await res.json()) as Array<{ path: string; type: string }>;
      for (const item of items) {
        if (item.type === 'blob') upstreamBlobs.push({ path: item.path, size: 0 });
      }
      if (items.length < 100) break;
      page++;
    }
  }

  // Apply .gitignore filter
  const upstreamPaths = upstreamBlobs.map((b) => b.path);
  const filtered = await filterIgnored(upstreamPaths, async () => {
    const url =
      source.platform === 'github'
        ? `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/.gitignore`
        : `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${source.owner}/${source.repo}`)}/repository/files/${encodeURIComponent('.gitignore')}/raw?ref=${encodeURIComponent(source.branch)}`;
    const raw = await fetch(url);
    return raw.ok ? raw.text() : null;
  });
  const filteredSet = new Set(filtered);
  upstreamBlobs = upstreamBlobs.filter((b) => filteredSet.has(b.path));
  const upstreamMap = new Map(upstreamBlobs.map((b) => [b.path, b.size]));

  // 2. Walk current GitLike tree
  onProgress('Comparing with local tree...');
  const headCid = manifest.branches[manifest.defaultBranch];
  if (!headCid) throw new Error('No head commit found.');
  const commit = await fetchJSON<Commit>(headCid);
  const localFiles = await collectTreeFiles(commit.tree);

  // 3. Diff
  const toUpload: string[] = []; // new or changed
  const toDelete: string[] = []; // removed upstream

  for (const [path, upSize] of upstreamMap) {
    const local = localFiles.get(path);
    if (!local) {
      toUpload.push(path); // new file
    } else if (source.platform === 'github' && upSize > 0 && upSize !== local.size) {
      toUpload.push(path); // size changed
    } else if (source.platform === 'gitlab') {
      toUpload.push(path); // GitLab doesn't return sizes in tree API, re-upload all
    }
  }
  for (const path of localFiles.keys()) {
    if (!upstreamMap.has(path)) toDelete.push(path);
  }

  if (toUpload.length === 0 && toDelete.length === 0) {
    onProgress('\u2713 Already up to date!', true);
    return { commitCid: headCid, added: 0, updated: 0, deleted: 0 };
  }

  onProgress(`${toUpload.length} file(s) to sync, ${toDelete.length} to remove...`);

  // 4. Upload changed/new files
  const rawUrlFn =
    source.platform === 'github'
      ? (path: string) =>
          `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${path}`
      : (path: string) => {
          const pp = encodeURIComponent(`${source.owner}/${source.repo}`);
          return `https://gitlab.com/api/v4/projects/${pp}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(source.branch)}`;
        };

  const staged: Array<{ path: string; cid: CID; size: number; deleted?: boolean }> = [];
  const limit = createConcurrencyLimiter(IMPORT_CONCURRENCY);
  let uploaded = 0;

  const tasks = toUpload.map((filePath) =>
    limit(async () => {
      const rawRes = await fetch(rawUrlFn(filePath));
      if (!rawRes.ok) return;
      const content = await rawRes.arrayBuffer();
      const file = new File([content], filePath.split('/').pop() ?? 'file', {
        type: 'application/octet-stream',
      });
      const { cid, size } = await uploadFile(repoId, file);
      staged.push({ path: filePath, cid, size });
      uploaded++;
      if (uploaded % 10 === 0 || uploaded === toUpload.length) {
        onProgress(`Uploading ${uploaded}/${toUpload.length}: ${filePath}`);
      }
    }),
  );
  await Promise.all(tasks);

  // Mark deleted files
  for (const path of toDelete) {
    const local = localFiles.get(path)!;
    staged.push({ path, cid: local.cid, size: 0, deleted: true });
  }

  // 5. Commit
  onProgress('Creating sync commit...');
  const added = toUpload.filter((p) => !localFiles.has(p)).length;
  const updated = toUpload.length - added;
  const { commitCid: newCommitCid } = await commitFiles(
    repoId,
    manifest.defaultBranch,
    `Sync from ${source.platform}: ${source.owner}/${source.repo}@${source.branch}`,
    staged,
  );

  onProgress(
    `\u2713 Synced! ${added} added, ${updated} updated, ${toDelete.length} deleted.`,
    true,
  );
  return { commitCid: newCommitCid, added, updated, deleted: toDelete.length };
}

// ---------------------------------------------------------------------------
// Alias API
// ---------------------------------------------------------------------------

/** Cached user profile (alias + pfp + bio). */
type ProfileCache = { alias: string | null; pfp: string | null; bio: string | null; ts: number };
const _profileCache = new Map<string, ProfileCache>();
const _profilePending = new Map<
  string,
  Promise<{ alias: string | null; pfp: string | null; bio: string | null }>
>();

/** Profile cache TTL in milliseconds. */
const PROFILE_TTL = 60_000;

/** Fetch the full profile (alias + pfp + bio) for an address (cached, deduped). */
export async function fetchProfile(
  address: string,
): Promise<{ alias: string | null; pfp: string | null; bio: string | null }> {
  const lower = address.toLowerCase();
  const cached = _profileCache.get(lower);
  if (cached && Date.now() - cached.ts < PROFILE_TTL) {
    return { alias: cached.alias, pfp: cached.pfp, bio: cached.bio };
  }

  const pending = _profilePending.get(lower);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`${API_BASE}/alias/${lower}`);
      if (!res.ok) return { alias: null, pfp: null, bio: null };
      const data = (await res.json()) as {
        alias: string | null;
        pfp: string | null;
        bio: string | null;
      };
      _profileCache.set(lower, { alias: data.alias, pfp: data.pfp, bio: data.bio, ts: Date.now() });
      return { alias: data.alias, pfp: data.pfp, bio: data.bio };
    } catch {
      return { alias: null, pfp: null, bio: null };
    } finally {
      _profilePending.delete(lower);
    }
  })();

  _profilePending.set(lower, p);
  return p;
}

/** Fetch the display alias for an address (cached, deduped). */
export async function fetchAlias(address: string): Promise<string | null> {
  const { alias } = await fetchProfile(address);
  return alias;
}

/** Set the alias for the connected wallet. */
export async function setAlias(alias: string): Promise<void> {
  await apiFetch('/alias', { method: 'PUT', body: JSON.stringify({ alias }) }, true);
}

/** Set the bio for the connected wallet. */
export async function setBio(bio: string): Promise<void> {
  await apiFetch('/bio', { method: 'PUT', body: JSON.stringify({ bio }) }, true);
}

/** Set the PFP for the connected wallet. */
export async function setPfp(opts: { url?: string; ens?: boolean }): Promise<string | null> {
  const res = await apiFetch('/pfp', { method: 'PUT', body: JSON.stringify(opts) }, true);
  const data = (await res.json()) as { pfp: string | null };
  return data.pfp;
}

/** Invalidate the profile cache for an address. */
export function invalidateProfile(address: string): void {
  _profileCache.delete(address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Follow API
// ---------------------------------------------------------------------------

/** Follow response shape. */
type FollowCounts = { followingCount: number; followersCount: number };

/** Follow list response shape. */
type FollowList = { addresses: string[]; count: number };

/** Follow a user. */
export async function followUser(address: string): Promise<FollowCounts> {
  const res = await apiFetch(
    '/follow',
    {
      method: 'POST',
      body: JSON.stringify({ address }),
    },
    true,
  );
  return res.json() as Promise<FollowCounts>;
}

/** Unfollow a user. */
export async function unfollowUser(address: string): Promise<FollowCounts> {
  const res = await apiFetch(`/follow/${address.toLowerCase()}`, { method: 'DELETE' }, true);
  return res.json() as Promise<FollowCounts>;
}

/** Get the list of addresses a user follows. */
export async function getFollowing(address: string): Promise<FollowList> {
  const res = await apiFetch(`/following/${address.toLowerCase()}`);
  return res.json() as Promise<FollowList>;
}

/** Get the list of addresses that follow a user. */
export async function getFollowers(address: string): Promise<FollowList> {
  const res = await apiFetch(`/followers/${address.toLowerCase()}`);
  return res.json() as Promise<FollowList>;
}

// ---------------------------------------------------------------------------
// Star API
// ---------------------------------------------------------------------------

/** Star response shape. */
type StarResponse = { count: number; starred: boolean };

/** Star a repo. */
export async function starRepo(repoId: GroupId): Promise<StarResponse> {
  const res = await apiFetch(`/repos/${repoId}/star`, { method: 'POST' }, true);
  return res.json() as Promise<StarResponse>;
}

/** Unstar a repo. */
export async function unstarRepo(repoId: GroupId): Promise<StarResponse> {
  const res = await apiFetch(`/repos/${repoId}/star`, { method: 'DELETE' }, true);
  return res.json() as Promise<StarResponse>;
}

/** Get star count and whether the current user has starred it. */
export async function getRepoStars(repoId: GroupId): Promise<StarResponse> {
  const res = await apiFetch(`/repos/${repoId}/stars`, {}, false, true);
  return res.json() as Promise<StarResponse>;
}

/** Get the list of repo IDs a user has starred. */
export async function getStarredRepos(address: string): Promise<string[]> {
  const res = await apiFetch(`/user/${address.toLowerCase()}/starred`);
  const data = (await res.json()) as { repos: string[] };
  return data.repos;
}

// ---------------------------------------------------------------------------
// Contributions API
// ---------------------------------------------------------------------------

/** Fetch contribution counts (date → count) for the last 365 days. */
export async function fetchContributions(address: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${API_BASE}/user/${address.toLowerCase()}/contributions`);
    if (!res.ok) return {};
    const data = (await res.json()) as { contributions: Record<string, number> };
    return data.contributions;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Platform Settings API
// ---------------------------------------------------------------------------

/** Platform-wide settings. */
export type PlatformSettings = {
  openCreation: boolean;
  writers: string[];
  platformName: string;
  platformDescription: string;
  retentionDepth: number;
  pinnedRepo: string;
};

/** Caller's role on this platform instance. */
export type PlatformRole = 'admin' | 'writer' | 'visitor';

/** Response from GET /api/platform/settings. */
export type PlatformSettingsResponse = {
  settings: PlatformSettings;
  role: PlatformRole;
};

/** Cached platform settings. */
let _platformCache: { data: PlatformSettingsResponse; ts: number } | null = null;
const PLATFORM_TTL = 30_000;

/** Fetch platform settings and caller role. */
export async function fetchPlatformSettings(): Promise<PlatformSettingsResponse> {
  if (_platformCache && Date.now() - _platformCache.ts < PLATFORM_TTL) {
    return _platformCache.data;
  }
  const res = await apiFetch('/platform/settings', {}, false, true);
  const data = (await res.json()) as PlatformSettingsResponse;
  _platformCache = { data, ts: Date.now() };
  return data;
}

/** Update platform settings (admin only). */
export async function updatePlatformSettings(
  settings: Partial<PlatformSettings>,
): Promise<{ settings: PlatformSettings }> {
  const res = await apiFetch(
    '/platform/settings',
    { method: 'PUT', body: JSON.stringify(settings) },
    true,
  );
  const data = (await res.json()) as { settings: PlatformSettings };
  _platformCache = null; // Invalidate cache
  return data;
}

/** Invalidate the cached platform settings. */
export function invalidatePlatformSettings(): void {
  _platformCache = null;
}

/** Pinata storage usage response. */
export type PlatformUsage = { storageBytes: number; fileCount: number };

/** Fetch Pinata storage usage (admin only). */
export async function fetchPlatformUsage(): Promise<PlatformUsage> {
  const res = await apiFetch('/platform/usage', {}, true);
  return res.json() as Promise<PlatformUsage>;
}

// ---------------------------------------------------------------------------
// Project API
// ---------------------------------------------------------------------------

/** Project summary from the list endpoint. */
export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  repoCount: number;
  owner: string;
  createdAt: string;
};

/** Full project detail (includes repo IDs). */
export type ProjectDetail = {
  id: string;
  name: string;
  description: string;
  repos: string[];
  owner: string;
  visibility?: 'public' | 'private';
  createdAt: string;
};

/** List projects. Pass `owner` to filter by creator address. */
export async function listProjects(owner?: string): Promise<{ projects: ProjectSummary[] }> {
  const url = owner ? `/projects?owner=${encodeURIComponent(owner)}` : '/projects';
  const res = await apiFetch(url);
  return res.json();
}

/** Fetch a single project by ID. */
export async function fetchProject(id: string): Promise<ProjectDetail | null> {
  try {
    const res = await apiFetch(`/projects/${id}`);
    const data = (await res.json()) as { project: ProjectDetail };
    return data.project;
  } catch {
    return null;
  }
}

/** Create a project linking the given repo IDs. */
export async function createProjectApi(
  name: string,
  description: string,
  repos: string[],
  visibility: 'public' | 'private' = 'public',
): Promise<{ project: ProjectSummary }> {
  const res = await apiFetch(
    '/projects',
    { method: 'POST', body: JSON.stringify({ name, description, repos, visibility }) },
    true,
  );
  return res.json();
}

/** Project slug → projectId cache. */
const _projectSlugCache = new Map<string, string>();

/** Resolve a project slug to a project ID. */
export async function resolveProjectSlug(slug: string): Promise<string> {
  const cached = _projectSlugCache.get(slug);
  if (cached) return cached;
  const res = await apiFetch(`/projects/resolve/${encodeURIComponent(slug)}`);
  const data = (await res.json()) as { projectId: string };
  _projectSlugCache.set(slug, data.projectId);
  return data.projectId;
}

/** Update a project (owner/admin). */
export async function updateProjectApi(
  id: string,
  patch: {
    name?: string;
    description?: string;
    repos?: string[];
    visibility?: 'public' | 'private';
  },
): Promise<{ project: ProjectDetail }> {
  const res = await apiFetch(
    `/projects/${id}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    true,
  );
  return res.json();
}

/** Delete a project (owner/admin). */
export async function deleteProjectApi(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: 'DELETE' }, true);
}

/** Fetch projects that contain a given repo. */
export async function fetchRepoProjects(repoGroupId: string): Promise<ProjectSummary[]> {
  try {
    const res = await apiFetch(`/repos/${repoGroupId}/projects`);
    const data = (await res.json()) as { projects: ProjectSummary[] };
    return data.projects;
  } catch {
    return [];
  }
}

/** Toggle GitLike Pages for a repo. */
export async function togglePages(
  repoId: GroupId,
  enabled: boolean,
  slug?: string,
  branch?: string,
  folder?: string,
): Promise<{ manifestCid: string; slug: string | null }> {
  const res = await apiFetch(
    `/repos/${repoId}/pages`,
    { method: 'POST', body: JSON.stringify({ enabled, slug, branch, folder }) },
    true,
  );
  invalidateManifest(repoId);
  return res.json();
}

// ---------------------------------------------------------------------------
// Federation API
// ---------------------------------------------------------------------------

/** Repo summary from a federated peer. */
export type FederatedRepo = {
  name: string;
  description: string;
  owner: string;
  domain: string;
  updatedAt: string;
};

/** Federated peer instance. */
export type FederatedPeer = {
  domain: string;
  name: string;
  version: string;
  repoCount: number;
  status: 'online' | 'offline' | 'pending';
  registeredAt: string;
  lastSyncAt: string | null;
  repos: FederatedRepo[];
};

/** Fetch all federated peers. */
export async function fetchFederatedPeers(): Promise<FederatedPeer[]> {
  try {
    const res = await fetch(`${API_BASE}/federation/peers`);
    if (!res.ok) return [];
    const data = (await res.json()) as { peers: FederatedPeer[] };
    return data.peers;
  } catch {
    return [];
  }
}

/** Register a new federated peer (admin only). */
export async function registerPeer(domain: string): Promise<{ peer: FederatedPeer }> {
  const res = await apiFetch(
    '/federation/register',
    { method: 'POST', body: JSON.stringify({ domain }) },
    true,
  );
  return res.json();
}

/** Remove a federated peer (admin only). */
export async function removePeer(domain: string): Promise<void> {
  await apiFetch(`/federation/peers/${encodeURIComponent(domain)}`, { method: 'DELETE' }, true);
}

/** Manually trigger federation sync (admin only). */
export async function syncPeers(): Promise<{ synced: number }> {
  const res = await apiFetch('/federation/sync', { method: 'POST' }, true);
  return res.json();
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch(
  path: string,
  init: RequestInit = {},
  requireAuth = false,
  sendAuthIfAvailable = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (requireAuth) {
    const token = getSessionToken();
    if (!token) throw new Error('Not authenticated. Please connect your wallet.');
    headers['Authorization'] = `Bearer ${token}`;
  } else if (sendAuthIfAvailable) {
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    let msg = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {
      // Ignore parse errors
    }
    throw new Error(msg);
  }

  return res;
}

/** Concurrency limiter — runs at most `max` tasks in parallel. */
function createConcurrencyLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          if (queue.length > 0) queue.shift()!();
        }
      };

      if (active < max) {
        run();
      } else {
        queue.push(run);
      }
    });
}

/** Retry an async function with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  throw lastError ?? new Error('Retry failed');
}

/** Fetch with exponential backoff retry. */
async function fetchWithRetry(url: string, maxRetries = MAX_RETRIES): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  throw lastError ?? new Error('Fetch failed');
}
