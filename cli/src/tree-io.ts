// ---------------------------------------------------------------------------
// GitLike CLI — Tree I/O
// Shared utilities for downloading IPFS trees to the local filesystem.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fetchJSON, fetchBytes } from './api.js';
import type { Tree } from './api.js';
import { createLimiter, CONCURRENCY } from './concurrency.js';
import { collectFiles, loadIgnorePatterns } from './file-filter.js';

// ---------------------------------------------------------------------------
// Tree download
// ---------------------------------------------------------------------------

/** Recursively download a tree to a local directory. Skips blobs whose CID is in skipCids. */
export async function downloadTree(
  tree: Tree,
  dir: string,
  onFile: (filePath: string) => void,
  skipCids?: Set<string>,
): Promise<void> {
  const limit = createLimiter(CONCURRENCY);

  const walk = async (t: Tree, d: string): Promise<void> => {
    const tasks: Promise<void>[] = [];

    for (const entry of t.entries) {
      const target = path.join(d, entry.name);

      if (entry.kind === 'tree') {
        tasks.push(
          (async () => {
            fs.mkdirSync(target, { recursive: true });
            const sub = await fetchJSON<Tree>(entry.cid);
            await walk(sub, target);
          })(),
        );
      } else {
        // Skip download if the file CID hasn't changed
        if (skipCids?.has(entry.cid)) continue;

        tasks.push(
          limit(async () => {
            const data = await fetchBytes(entry.cid);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, data);
            onFile(target);
          }),
        );
      }
    }

    await Promise.all(tasks);
  };

  await walk(tree, dir);
}

// ---------------------------------------------------------------------------
// Tree index builder
// ---------------------------------------------------------------------------

/** Build a flat { relativePath → cid } map from a remote tree. */
export async function buildTreeIndex(treeCid: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  const walk = async (tree: Tree, prefix: string): Promise<void> => {
    for (const entry of tree.entries) {
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'tree') {
        const sub = await fetchJSON<Tree>(entry.cid);
        await walk(sub, p);
      } else {
        index.set(p, entry.cid);
      }
    }
  };

  const tree = await fetchJSON<Tree>(treeCid);
  await walk(tree, '');
  return index;
}

/** Build a sha256-based local hash index from files on disk. */
export function buildLocalHashIndex(root: string): Record<string, string> {
  const patterns = loadIgnorePatterns(root);
  const files = collectFiles(root, patterns);
  const index: Record<string, string> = {};
  for (const relPath of files) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
    const content = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    index[relPath] = `sha256:${hash}`;
  }
  return index;
}
