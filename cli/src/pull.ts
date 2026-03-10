// ---------------------------------------------------------------------------
// GitLike CLI — Pull Command
// Fetches latest HEAD and updates local files.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fetchManifest, fetchJSON } from './api.js';
import {
  requireRepo,
  writeRepoState,
  writeLocalIndex,
  readCidIndex,
  writeCidIndex,
} from './config.js';
import { downloadTree, buildTreeIndex, buildLocalHashIndex } from './tree-io.js';
import type { Commit, Tree } from './api.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories never deleted during cleanup. */
const PROTECTED_DIRS = new Set(['.gitlike', '.git', 'node_modules']);

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/** Pull latest changes from remote. */
export async function pullRepo(): Promise<void> {
  const { root, state } = requireRepo();

  console.log(`Pulling ${state.name} (${state.branch})...`);

  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error('Repository not found on remote.');
    process.exit(1);
  }

  const remoteCid = manifest.branches[state.branch];
  if (!remoteCid) {
    console.error(`Branch "${state.branch}" not found on remote.`);
    process.exit(1);
  }

  if (remoteCid === state.head) {
    console.log('Already up to date.');
    return;
  }

  const commit = await fetchJSON<Commit>(remoteCid);
  const tree = await fetchJSON<Tree>(commit.tree);

  // Build remote file set for stale cleanup
  const remoteIndex = await buildTreeIndex(commit.tree);
  const remotePaths = new Set(remoteIndex.keys());

  // Build skip set from local CID index for incremental download
  const oldCidIndex = readCidIndex(root);
  const skipCids = new Set<string>();
  for (const [filePath, cid] of remoteIndex) {
    if (oldCidIndex[filePath] === cid) skipCids.add(cid);
  }

  let downloaded = 0;
  await downloadTree(
    tree,
    root,
    () => {
      downloaded++;
    },
    skipCids,
  );

  const skipped = remoteIndex.size - downloaded;

  // Remove local files not present in remote tree
  const deleted = cleanStaleFiles(root, remotePaths);

  // Update state + CID index + sha256 hash index
  writeRepoState({ ...state, head: remoteCid }, root);
  writeCidIndex(Object.fromEntries(remoteIndex), root);
  writeLocalIndex(buildLocalHashIndex(root), root);

  const parts = [`\u2713 Updated ${downloaded} files`];
  if (skipped > 0) parts.push(`${skipped} unchanged`);
  if (deleted > 0) parts.push(`removed ${deleted} stale`);
  parts.push(`HEAD is now ${remoteCid.slice(0, 12)}\u2026`);
  console.log(parts.join(', ') + '.');
}

// ---------------------------------------------------------------------------
// Stale file cleanup
// ---------------------------------------------------------------------------

/** Remove local files that are no longer in the remote tree. Returns count deleted. */
function cleanStaleFiles(root: string, remotePaths: Set<string>): number {
  let deleted = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (PROTECTED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        // Remove directory if now empty
        try {
          const remaining = fs.readdirSync(full);
          if (remaining.length === 0) fs.rmdirSync(full);
        } catch {
          // Best-effort
        }
      } else {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (!remotePaths.has(rel)) {
          fs.unlinkSync(full);
          deleted++;
        }
      }
    }
  };

  walk(root);
  return deleted;
}
