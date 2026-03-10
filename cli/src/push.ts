// ---------------------------------------------------------------------------
// GitLike CLI — Push Command
// Scans local files, uploads changed ones, creates a commit.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  requireAuth,
  requireRepo,
  writeRepoState,
  readLocalIndex,
  writeLocalIndex,
} from './config.js';
import { uploadFile, commitFiles, fetchManifest } from './api.js';
import { collectFiles, loadIgnorePatterns } from './file-filter.js';
import { createLimiter, CONCURRENCY } from './concurrency.js';

/** Push local changes as a new commit. */
export async function pushRepo(message: string, filePaths?: string[]): Promise<void> {
  requireAuth();
  const { root, state } = requireRepo();

  console.log(`Pushing to ${state.name} (${state.branch})...`);

  // Check for stale HEAD before doing any work
  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error('Repository not found on remote.');
    process.exit(1);
  }
  const remoteHead = manifest.branches[state.branch];
  if (remoteHead && remoteHead !== state.head) {
    console.error(`Remote HEAD has advanced. Run: gitlike pull`);
    process.exit(1);
  }

  // Load ignore patterns and local change-tracking index
  const patterns = loadIgnorePatterns(root);
  const localIndex = readLocalIndex(root);

  // Determine which files to consider
  const allLocal = filePaths?.length
    ? filePaths.map((p) => p.replace(/\\/g, '/'))
    : collectFiles(root, patterns);

  // Filter to only changed files using content hash comparison
  const changed: string[] = [];
  const hashes = new Map<string, string>();

  for (const relPath of allLocal) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;

    const content = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    hashes.set(relPath, hash);

    // If we have a stored hash and it matches, skip this file
    const storedCid = localIndex[relPath];
    if (storedCid && storedCid.startsWith('sha256:') && storedCid === `sha256:${hash}`) {
      continue;
    }

    changed.push(relPath);
  }

  if (changed.length === 0) {
    console.log('No changes to push.');
    return;
  }

  console.log(`  ${changed.length} changed file(s) to upload (${allLocal.length} total)`);

  // Upload changed files in parallel
  const limit = createLimiter(CONCURRENCY);
  const staged: Array<{ path: string; cid: string; size: number }> = [];
  let uploaded = 0;

  const tasks = changed.map((relPath) =>
    limit(async () => {
      const fullPath = path.join(root, relPath);
      const content = new Uint8Array(fs.readFileSync(fullPath));
      const fileName = path.basename(relPath);
      const { cid, size } = await uploadFile(state.groupId, fileName, content);
      staged.push({ path: relPath, cid, size });
      process.stdout.write(`\r  Uploaded ${++uploaded}/${changed.length}`);
    }),
  );
  await Promise.all(tasks);

  process.stdout.write('\r  Committing...                                    \n');

  const result = await commitFiles(state.groupId, state.branch, message, staged, state.head);

  // Update state
  writeRepoState({ ...state, head: result.commitCid }, root);

  // Update local index with content hashes for all known files
  const newIndex: Record<string, string> = {};
  for (const [p, hash] of hashes) {
    newIndex[p] = `sha256:${hash}`;
  }
  writeLocalIndex(newIndex, root);

  console.log(`\u2713 Committed ${staged.length} files. ${result.commitCid.slice(0, 12)}\u2026`);
}
