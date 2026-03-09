// ---------------------------------------------------------------------------
// GitLike — KV Repo Index
// Maintains a lightweight index of all repos in a single KV key for fast
// listing. Eliminates the O(n) Pinata API calls per list request.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary stored per repo in the index. */
export type RepoIndexEntry = {
  groupId: string;
  name: string;
  description: string;
  owner: string;
  /** Writers who can push to this repo (lowercased). */
  writers?: string[];
  visibility: 'public' | 'private';
  updatedAt: string;
};

/** KV key for the repo index. */
const REPO_INDEX_KEY = 'repo_index';

/** KV prefix for slug → groupId mappings. */
const SLUG_PREFIX = 'slug:';

/** Convert a repo name to a URL-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Look up the groupId for a slug. Returns null if not found. */
export async function getSlug(env: Env, slug: string): Promise<string | null> {
  return env.SESSIONS.get(`${SLUG_PREFIX}${slug}`);
}

/** Store a slug → groupId mapping. */
export async function setSlug(env: Env, slug: string, groupId: string): Promise<void> {
  await env.SESSIONS.put(`${SLUG_PREFIX}${slug}`, groupId);
}

/** Delete a slug mapping. */
export async function deleteSlug(env: Env, slug: string): Promise<void> {
  await env.SESSIONS.delete(`${SLUG_PREFIX}${slug}`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Read the full repo index from KV. Returns empty array if not bootstrapped. */
export async function getRepoIndex(env: Env): Promise<RepoIndexEntry[]> {
  const raw = await env.SESSIONS.get(REPO_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RepoIndexEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Add a repo to the index. */
export async function addToIndex(env: Env, entry: RepoIndexEntry): Promise<void> {
  const index = await getRepoIndex(env);
  // Deduplicate by groupId
  const filtered = index.filter((e) => e.groupId !== entry.groupId);
  filtered.push(entry);
  await env.SESSIONS.put(REPO_INDEX_KEY, JSON.stringify(filtered));
}

/** Remove a repo from the index. */
export async function removeFromIndex(env: Env, groupId: string): Promise<void> {
  const index = await getRepoIndex(env);
  const filtered = index.filter((e) => e.groupId !== groupId);
  await env.SESSIONS.put(REPO_INDEX_KEY, JSON.stringify(filtered));
}

/** Update fields of an existing index entry. */
export async function updateIndexEntry(
  env: Env,
  groupId: string,
  patch: Partial<Omit<RepoIndexEntry, 'groupId'>>,
): Promise<void> {
  const index = await getRepoIndex(env);
  const idx = index.findIndex((e) => e.groupId === groupId);
  if (idx < 0) return;
  index[idx] = { ...index[idx], ...patch, updatedAt: new Date().toISOString() };
  await env.SESSIONS.put(REPO_INDEX_KEY, JSON.stringify(index));
}

// ---------------------------------------------------------------------------
// Bootstrap — populate index from KV manifest entries (one-time migration)
// ---------------------------------------------------------------------------

import { fetchJSON } from './ipfs.js';
import type { Manifest } from './ipfs.js';

/** Bootstrap the index by scanning KV manifest entries. Skips if index already populated. */
export async function bootstrapIndex(env: Env): Promise<number> {
  const existing = await getRepoIndex(env);
  if (existing.length > 0) return existing.length;

  // Scan KV for all manifest:<groupId> entries
  const keys = await env.SESSIONS.list({ prefix: 'manifest:' });
  const entries: RepoIndexEntry[] = [];

  for (const key of keys.keys) {
    const groupId = key.name.replace('manifest:', '');
    const cid = await env.SESSIONS.get(key.name);
    if (!cid) continue;
    try {
      const manifest = await fetchJSON<Manifest>(env, cid);
      entries.push({
        groupId,
        name: manifest.name,
        description: manifest.description,
        owner: manifest.acl.owners[0] ?? '',
        writers: manifest.acl.writers.map((w) => w.toLowerCase()),
        visibility: manifest.visibility ?? 'public',
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Manifest fetch failed — skip this repo
    }
  }

  if (entries.length > 0) {
    await env.SESSIONS.put(REPO_INDEX_KEY, JSON.stringify(entries));
  }
  return entries.length;
}

/** Populate slug mappings from the repo index. Writes only missing slugs. */
export async function bootstrapSlugs(env: Env): Promise<void> {
  const index = await getRepoIndex(env);
  for (const entry of index) {
    const slug = slugify(entry.name);
    if (!slug) continue;
    const existing = await getSlug(env, slug);
    if (!existing) {
      await setSlug(env, slug, entry.groupId);
    }
  }
}
