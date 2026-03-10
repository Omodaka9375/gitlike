// ---------------------------------------------------------------------------
// GitLike CLI — Clone Command
// Downloads a repo's files to the local filesystem.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fetchManifest, fetchJSON } from './api.js';
import { writeRepoState, writeLocalIndex, writeCidIndex } from './config.js';
import { downloadTree, buildTreeIndex, buildLocalHashIndex } from './tree-io.js';
import type { Commit, Tree } from './api.js';

/** Clone a repo by groupId into a local directory. */
export async function cloneRepo(groupId: string, targetDir?: string): Promise<void> {
  console.log(`Fetching manifest for ${groupId}...`);
  const manifest = await fetchManifest(groupId);
  if (!manifest) {
    console.error('Repository not found.');
    process.exit(1);
  }

  const dir = targetDir || manifest.name || groupId;
  const root = path.resolve(dir);

  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    console.error(`Directory "${dir}" already exists and is not empty.`);
    process.exit(1);
  }

  const branch = manifest.defaultBranch || 'main';
  const headCid = manifest.branches[branch];
  if (!headCid) {
    console.error(`Branch "${branch}" not found.`);
    process.exit(1);
  }

  console.log(`Cloning ${manifest.name} (${branch}) into ${dir}/`);

  const commit = await fetchJSON<Commit>(headCid);
  const tree = await fetchJSON<Tree>(commit.tree);

  fs.mkdirSync(root, { recursive: true });

  let count = 0;
  await downloadTree(tree, root, () => {
    count++;
    if (count % 10 === 0) process.stdout.write(`\r  Downloaded ${count} files...`);
  });

  // Write repo state + CID index + sha256 hash index
  writeRepoState({ groupId, name: manifest.name, branch, head: headCid }, root);
  const cidIndex = await buildTreeIndex(commit.tree);
  writeCidIndex(Object.fromEntries(cidIndex), root);
  writeLocalIndex(buildLocalHashIndex(root), root);

  console.log(`\r\u2713 Cloned ${count} files into ${dir}/`);
}
