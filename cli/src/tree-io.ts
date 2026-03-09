// ---------------------------------------------------------------------------
// GitLike CLI — Tree I/O
// Shared utilities for downloading IPFS trees to the local filesystem.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fetchJSON, fetchBytes } from './api.js';
import type { Tree } from './api.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max concurrent file downloads. */
const CONCURRENCY = 6;

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

/** Creates a promise-based concurrency limiter. */
function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
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

// ---------------------------------------------------------------------------
// Tree download
// ---------------------------------------------------------------------------

/** Recursively download a tree to a local directory. */
export async function downloadTree(
  tree: Tree,
  dir: string,
  onFile: (filePath: string) => void,
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
