// ---------------------------------------------------------------------------
// GitLike Shared View Helpers
// ---------------------------------------------------------------------------

import { el } from './dom.js';
import { hasSession } from '../api.js';
import { connectedAddress } from '../wallet.js';
import { getFollowing as fetchServerFollowing } from '../api.js';
import type { Manifest } from '../types.js';

/** Render a "← Repositories" link above repo views. */
export function renderBackToRepos(): HTMLElement {
  return el('a', { cls: 'back-to-repos', text: '\u2190 Repositories', attrs: { href: '/' } });
}

// ---------------------------------------------------------------------------
// Follow system (localStorage)
// ---------------------------------------------------------------------------

const FOLLOWING_KEY = 'gitlike_following';

/** Get the list of followed addresses. */
export function getFollowing(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLLOWING_KEY) || '[]');
  } catch {
    return [];
  }
}

/** Toggle follow state for an address. */
export function toggleFollow(address: string): boolean {
  const list = getFollowing();
  const lower = address.toLowerCase();
  const idx = list.findIndex((a) => a.toLowerCase() === lower);
  if (idx >= 0) {
    list.splice(idx, 1);
    localStorage.setItem(FOLLOWING_KEY, JSON.stringify(list));
    return false;
  }
  list.push(address);
  localStorage.setItem(FOLLOWING_KEY, JSON.stringify(list));
  return true;
}

/** Sync localStorage following list from server (best-effort). */
export function syncFollowingFromServer(address: string): void {
  fetchServerFollowing(address)
    .then(({ addresses }) => {
      localStorage.setItem(FOLLOWING_KEY, JSON.stringify(addresses));
    })
    .catch(() => {});
}

/** Check if the connected wallet can write to a repo. */
export function canWrite(manifest: Manifest | null): boolean {
  if (!manifest) return false;
  const addr = connectedAddress();
  if (!addr || !hasSession()) return false;
  const lower = addr.toLowerCase();
  return (
    manifest.acl.owners.some((a) => a.toLowerCase() === lower) ||
    manifest.acl.writers.some((a) => a.toLowerCase() === lower) ||
    (manifest.acl.agents != null &&
      Object.keys(manifest.acl.agents).some((a) => a.toLowerCase() === lower))
  );
}
