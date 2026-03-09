// ---------------------------------------------------------------------------
// GitLike CLI — Log, Status, Branch, Diff Commands
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  requireRepo,
  requireAuth,
  writeRepoState,
  writeLocalIndex,
  readLocalIndex,
} from './config.js';
import { fetchManifest, fetchJSON, createBranch as apiBranch } from './api.js';
import type { Commit, Tree } from './api.js';
import { downloadTree, buildTreeIndex } from './tree-io.js';
import { collectFiles, loadIgnorePatterns } from './file-filter.js';

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/** Show commit history. */
export async function showLog(count = 20): Promise<void> {
  const { state } = requireRepo();

  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error('Repository not found.');
    process.exit(1);
  }

  const headCid = manifest.branches[state.branch];
  if (!headCid) {
    console.error(`Branch "${state.branch}" not found.`);
    process.exit(1);
  }

  console.log(`Log for ${state.name} (${state.branch}):\n`);

  let cid: string | null = headCid;
  let shown = 0;
  while (cid && shown < count) {
    const commit: Commit = await fetchJSON<Commit>(cid);
    const short = cid.slice(0, 12);
    const date = new Date(commit.timestamp).toLocaleString();
    const author = commit.author.slice(0, 6) + '…' + commit.author.slice(-4);

    console.log(`\x1b[33m${short}\x1b[0m ${commit.message}`);
    console.log(`  ${author}  ${date}\n`);

    cid = commit.parents.length > 0 ? commit.parents[0] : null;
    shown++;
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Show current repo status. */
export async function showStatus(): Promise<void> {
  const { root, state } = requireRepo();

  console.log(`Repository: ${state.name}`);
  console.log(`Group ID:   ${state.groupId}`);
  console.log(`Branch:     ${state.branch}`);
  console.log(`HEAD:       ${state.head.slice(0, 16)}…`);
  console.log(`Root:       ${root}`);

  const manifest = await fetchManifest(state.groupId);
  if (manifest) {
    const remoteCid = manifest.branches[state.branch];
    if (remoteCid && remoteCid !== state.head) {
      console.log(`\n⚠  Remote HEAD has advanced. Run: gitlike pull`);
    } else if (remoteCid === state.head) {
      console.log(`\n✓ Up to date with remote.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

/** List branches. */
export async function listBranches(): Promise<void> {
  const { state } = requireRepo();

  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error('Repository not found.');
    process.exit(1);
  }

  for (const name of Object.keys(manifest.branches)) {
    const marker = name === state.branch ? '* ' : '  ';
    const cid = manifest.branches[name].slice(0, 12);
    console.log(`${marker}${name}  (${cid}…)`);
  }
}

/** Create a new branch. */
export async function createNewBranch(name: string): Promise<void> {
  requireAuth();
  const { state } = requireRepo();

  console.log(`Creating branch "${name}" from "${state.branch}"...`);
  await apiBranch(state.groupId, name, state.branch);
  console.log(`✓ Branch "${name}" created.`);
}

/** Switch to a different branch and pull files. */
export async function switchBranch(name: string): Promise<void> {
  const { root, state } = requireRepo();

  const manifest = await fetchManifest(state.groupId);
  if (!manifest) {
    console.error('Repository not found.');
    process.exit(1);
  }

  const headCid = manifest.branches[name];
  if (!headCid) {
    console.error(`Branch "${name}" not found.`);
    process.exit(1);
  }

  console.log(`Switching to ${name}...`);

  const commit = await fetchJSON<Commit>(headCid);
  const tree = await fetchJSON<Tree>(commit.tree);

  let count = 0;
  await downloadTree(tree, root, () => {
    count++;
  });

  // Update state + local index
  writeRepoState({ ...state, branch: name, head: headCid }, root);
  const index = await buildTreeIndex(commit.tree);
  writeLocalIndex(Object.fromEntries(index), root);

  console.log(`✓ Switched to ${name}. ${count} files updated.`);
}

// ---------------------------------------------------------------------------
// Diff — file-level change summary
// ---------------------------------------------------------------------------

/** Show added/modified/deleted files compared to the local index. */
export function showDiff(): void {
  const { root } = requireRepo();
  const localIndex = readLocalIndex(root);
  const patterns = loadIgnorePatterns(root);
  const localFiles = collectFiles(root, patterns);

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  const seen = new Set<string>();

  for (const relPath of localFiles) {
    seen.add(relPath);
    const stored = localIndex[relPath];

    if (!stored) {
      added.push(relPath);
      continue;
    }

    // Compare content hash against stored hash
    const fullPath = path.join(root, relPath);
    const content = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (stored !== `sha256:${hash}`) {
      modified.push(relPath);
    }
  }

  // Files in index but not on disk
  for (const p of Object.keys(localIndex)) {
    if (!seen.has(p)) deleted.push(p);
  }

  if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
    console.log('No changes.');
    return;
  }

  for (const p of added) console.log(`\x1b[32m  A  ${p}\x1b[0m`);
  for (const p of modified) console.log(`\x1b[33m  M  ${p}\x1b[0m`);
  for (const p of deleted) console.log(`\x1b[31m  D  ${p}\x1b[0m`);

  console.log(`\n${added.length} added, ${modified.length} modified, ${deleted.length} deleted`);
}
