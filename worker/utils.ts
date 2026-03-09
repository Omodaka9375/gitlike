// ---------------------------------------------------------------------------
// GitLike — Worker Utilities
// Shared helpers used across worker modules.
// ---------------------------------------------------------------------------

import type { Manifest } from './ipfs.js';

/** Extract a short, user-friendly message from an error. */
export function errorMsg(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    const jsonIdx = msg.indexOf('{');
    if (jsonIdx > 0) return msg.slice(0, jsonIdx).trim().replace(/:$/, '');
    return msg;
  }
  return String(err);
}

/** Check if an address is an owner or writer of a repo. */
export function isOwnerOrWriter(address: string, manifest: Manifest): boolean {
  const lower = address.toLowerCase();
  return (
    manifest.acl.owners.some((a) => a.toLowerCase() === lower) ||
    manifest.acl.writers.some((a) => a.toLowerCase() === lower)
  );
}

/** Check if an address is a delegated agent with any action scope. */
export function isDelegatedAgent(address: string, manifest: Manifest): boolean {
  const lower = address.toLowerCase();
  const now = new Date();
  for (const entries of Object.values(manifest.acl.agents)) {
    for (const entry of entries) {
      if (entry.key.toLowerCase() !== lower) continue;
      if (new Date(entry.expires) <= now) continue;
      return true;
    }
  }
  return false;
}
