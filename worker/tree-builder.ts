// ---------------------------------------------------------------------------
// GitLike — Recursive Tree Builder
// Properly handles nested paths by building subtrees bottom-up.
// ---------------------------------------------------------------------------

import { pinJSON, fetchJSON } from './ipfs.js';
import type { Env } from './env.js';
import type { StorageProvider } from './storage.js';
import type { CID, GroupId, Tree } from './ipfs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A staged file ready for inclusion in a commit. */
export type StagedFile = {
  path: string;
  cid: CID;
  size: number;
  /** If true, the file is removed from the tree. */
  deleted?: boolean;
};

/** Intermediate tree node used during construction. */
type IntermediateEntry =
  | { kind: 'blob'; name: string; cid: CID; size: number }
  | { kind: 'tree'; name: string; children: IntermediateTree; existingCid?: CID };

type IntermediateTree = {
  entries: Map<string, IntermediateEntry>;
  /** Names explicitly deleted from this tree level. */
  deletions: Set<string>;
};

// ---------------------------------------------------------------------------
// Build tree from staged files merged with parent tree
// ---------------------------------------------------------------------------

/**
 * Build a new root tree by merging staged files into the parent tree.
 * Handles nested paths correctly by fetching and merging subtrees.
 * Returns the CID of the new root tree.
 */
export async function buildMergedTree(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  parentTree: Tree,
  staged: StagedFile[],
): Promise<CID> {
  // 1. Load parent tree into an intermediate representation
  const root = await loadIntermediateTree(env, parentTree);

  // 2. Apply staged files into the intermediate tree
  for (const file of staged) {
    applyFile(root, file);
  }

  // 3. Pin recursively bottom-up
  return pinIntermediateTree(provider, env, repo, root);
}

/**
 * Build a tree from scratch (no parent). Used for initial commits.
 */
export async function buildFreshTree(
  provider: StorageProvider,
  repo: GroupId,
  staged: StagedFile[],
): Promise<CID> {
  const root: IntermediateTree = { entries: new Map(), deletions: new Set() };

  for (const file of staged) {
    applyFile(root, file);
  }

  return pinFreshTree(provider, repo, root);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a Tree into an IntermediateTree, preserving existing CIDs for subtrees. */
async function loadIntermediateTree(_env: Env, tree: Tree): Promise<IntermediateTree> {
  const intermediate: IntermediateTree = { entries: new Map(), deletions: new Set() };

  for (const entry of tree.entries) {
    if (entry.kind === 'blob') {
      intermediate.entries.set(entry.name, {
        kind: 'blob',
        name: entry.name,
        cid: entry.cid,
        size: entry.size ?? 0,
      });
    } else {
      // For tree entries, we store the existing CID but lazily load children
      // only if a staged file targets this directory
      intermediate.entries.set(entry.name, {
        kind: 'tree',
        name: entry.name,
        children: { entries: new Map(), deletions: new Set() },
        existingCid: entry.cid,
      });
    }
  }

  return intermediate;
}

/** OS junk files/directories that should never be committed. */
const BLOCKED_NAMES = new Set(['.DS_Store', '__MACOSX', '.Spotlight-V100', '.Trashes', 'Thumbs.db']);

/** Check if a path contains a blocked OS junk segment. */
function isBlockedPath(path: string): boolean {
  return path.split('/').some((segment) => BLOCKED_NAMES.has(segment));
}

/** Insert or delete a staged file in the intermediate tree. */
function applyFile(root: IntermediateTree, file: StagedFile): void {
  // Safety net — reject OS junk files
  if (isBlockedPath(file.path)) return;

  const parts = file.path.split('/');
  let current = root;

  // Navigate/create intermediate directories
  for (let i = 0; i < parts.length - 1; i++) {
    const dirName = parts[i];
    let existing = current.entries.get(dirName);

    if (!existing || existing.kind !== 'tree') {
      if (file.deleted) return; // Path doesn't exist — nothing to delete
      existing = {
        kind: 'tree',
        name: dirName,
        children: { entries: new Map(), deletions: new Set() },
      };
      current.entries.set(dirName, existing);
    }

    current = existing.children;
  }

  const fileName = parts[parts.length - 1];

  if (file.deleted) {
    current.entries.delete(fileName);
    current.deletions.add(fileName);
    return;
  }

  current.entries.set(fileName, {
    kind: 'blob',
    name: fileName,
    cid: file.cid,
    size: file.size,
  });
}

/**
 * Recursively pin an intermediate tree bottom-up.
 * For tree entries with an existingCid but no new staged files in them,
 * we reuse the existing CID. Otherwise we need to load the subtree,
 * merge, and re-pin.
 */
async function pinIntermediateTree(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  node: IntermediateTree,
): Promise<CID> {
  const treeEntries: Tree['entries'] = [];

  for (const entry of node.entries.values()) {
    if (entry.kind === 'blob') {
      treeEntries.push({ name: entry.name, cid: entry.cid, kind: 'blob', size: entry.size });
    } else {
      let childCid: CID;

      const hasChanges = entry.children.entries.size > 0 || entry.children.deletions.size > 0;

      if (!hasChanges && entry.existingCid) {
        // No staged files in this subtree — reuse existing CID
        childCid = entry.existingCid;
      } else if (entry.existingCid) {
        // Staged files target this directory — load existing subtree, merge, re-pin
        const existingSubtree = await fetchJSON<Tree>(env, entry.existingCid);
        const merged = await loadIntermediateTree(env, existingSubtree);

        // Remove deleted entries from the merged tree
        for (const name of entry.children.deletions) {
          merged.entries.delete(name);
        }

        // Copy new entries into the merged tree
        for (const [name, newEntry] of entry.children.entries) {
          // If a staged file created an intermediate directory whose subtree was
          // never loaded (applyFile only sees top-level children), carry over the
          // pre-existing subtree's CID so deeper content isn't dropped on re-pin.
          if (newEntry.kind === 'tree' && !newEntry.existingCid) {
            const existing = merged.entries.get(name);
            if (existing && existing.kind === 'tree' && existing.existingCid) {
              newEntry.existingCid = existing.existingCid;
            }
          }
          merged.entries.set(name, newEntry);
        }

        // Propagate nested deletions
        for (const name of entry.children.deletions) {
          merged.deletions.add(name);
        }

        childCid = await pinIntermediateTree(provider, env, repo, merged);
      } else {
        // New directory (no existing CID)
        childCid = await pinIntermediateTree(provider, env, repo, entry.children);
      }

      // Prune empty subtrees — don't include directories with no entries
      if (childCid === EMPTY_TREE_SENTINEL) continue;

      treeEntries.push({ name: entry.name, cid: childCid, kind: 'tree' });
    }
  }

  // If all entries were deleted, signal to parent to prune this subtree
  if (treeEntries.length === 0) return EMPTY_TREE_SENTINEL;

  const tree: Tree = { type: 'tree', entries: treeEntries };
  const upload = await pinJSON(provider, tree, repo);
  return upload.cid;
}

/** Sentinel CID used to signal an empty tree that should be pruned. */
const EMPTY_TREE_SENTINEL = '__EMPTY__' as CID;

// ---------------------------------------------------------------------------
// Deep merge of two trees (for branch merges)
// ---------------------------------------------------------------------------

/**
 * Merge two pinned trees. Overlay entries win on conflict for blobs;
 * tree-tree conflicts are resolved recursively. Returns new root CID.
 */
export async function mergeTrees(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  baseTree: Tree,
  overlayTree: Tree,
): Promise<CID> {
  const base = await loadIntermediateTree(env, baseTree);
  const overlay = await loadIntermediateTree(env, overlayTree);
  mergeIntermediate(base, overlay);
  return pinIntermediateTree(provider, env, repo, base);
}

/** Recursively merge overlay entries into base (overlay wins). */
function mergeIntermediate(base: IntermediateTree, overlay: IntermediateTree): void {
  for (const [name, entry] of overlay.entries) {
    const existing = base.entries.get(name);

    if (!existing) {
      base.entries.set(name, entry);
      continue;
    }

    // Both are trees — recurse
    if (existing.kind === 'tree' && entry.kind === 'tree') {
      mergeIntermediate(existing.children, entry.children);
      if (entry.existingCid && existing.children.entries.size === 0) {
        existing.existingCid = entry.existingCid;
      }
      continue;
    }

    // Overlay wins (blob replaces tree, blob replaces blob, tree replaces blob)
    base.entries.set(name, entry);
  }
}

// ---------------------------------------------------------------------------
// True three-way merge (base + ours + theirs)
// ---------------------------------------------------------------------------

/**
 * Three-way merge of three trees (base, ours, theirs).
 *
 * Semantics:
 *  - A name changed on only one side is taken from that side.
 *  - A deletion on one side (while the other side is unchanged) is honored.
 *  - A name modified differently on both sides is reported as a conflict and
 *    resolved in favour of `ours` (the target branch) to avoid silent loss.
 *  - Subtree-vs-subtree changes are merged recursively.
 *
 * Returns the merged root CID and the list of genuine conflict paths.
 */
export async function mergeTrees3(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  baseTree: Tree,
  oursTree: Tree,
  theirsTree: Tree,
): Promise<{ cid: CID; conflicts: string[] }> {
  const conflicts: string[] = [];
  const base = await loadIntermediateDeep(env, baseTree);
  const ours = await loadIntermediateDeep(env, oursTree);
  const theirs = await loadIntermediateDeep(env, theirsTree);
  const merged = await threeWayMerge(provider, env, repo, base, ours, theirs, '', conflicts);
  const cid = await pinIntermediateTree(provider, env, repo, merged);
  return { cid, conflicts };
}

/** Fully load a Tree into an IntermediateTree (children recursively loaded). */
async function loadIntermediateDeep(env: Env, tree: Tree): Promise<IntermediateTree> {
  const intermediate: IntermediateTree = { entries: new Map(), deletions: new Set() };
  for (const entry of tree.entries) {
    if (entry.kind === 'blob') {
      intermediate.entries.set(entry.name, {
        kind: 'blob',
        name: entry.name,
        cid: entry.cid,
        size: entry.size ?? 0,
      });
    } else {
      const sub = await fetchJSON<Tree>(env, entry.cid);
      const children = await loadIntermediateDeep(env, sub);
      intermediate.entries.set(entry.name, {
        kind: 'tree',
        name: entry.name,
        children,
        existingCid: entry.cid,
      });
    }
  }
  return intermediate;
}

/** Two intermediate entries are equal when they resolve to the same content. */
function entriesEqual(a?: IntermediateEntry, b?: IntermediateEntry): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'blob') return a.cid === (b as Extract<IntermediateEntry, { kind: 'blob' }>).cid;
  // Both are trees — content is identified by their CID.
  return a.existingCid === (b as Extract<IntermediateEntry, { kind: 'tree' }>).existingCid;
}

/** Deep structural equality of two intermediate trees. */
function intermediateEqual(a: IntermediateTree, b: IntermediateTree): boolean {
  if (a.entries.size !== b.entries.size) return false;
  for (const [name, ea] of a.entries) {
    const eb = b.entries.get(name);
    if (!eb || ea.kind !== eb.kind) return false;
    if (ea.kind === 'blob') {
      const left = ea as Extract<IntermediateEntry, { kind: 'blob' }>;
      const right = eb as Extract<IntermediateEntry, { kind: 'blob' }>;
      if (left.cid !== right.cid || left.size !== right.size) return false;
    } else {
      const left = ea as Extract<IntermediateEntry, { kind: 'tree' }>;
      const right = eb as Extract<IntermediateEntry, { kind: 'tree' }>;
      if (!intermediateEqual(left.children, right.children)) return false;
    }
  }
  return true;
}

/** Represent an entry for verbatim reuse (trees keep their CID, no children). */
function carryEntry(e: IntermediateEntry): IntermediateEntry {
  if (e.kind === 'tree') {
    return {
      kind: 'tree',
      name: e.name,
      children: { entries: new Map(), deletions: new Set() },
      existingCid: e.existingCid,
    };
  }
  return e;
}

/** Recursive three-way merge producing a fully (or reusably) built tree. */
async function threeWayMerge(
  provider: StorageProvider,
  env: Env,
  repo: GroupId,
  base: IntermediateTree,
  ours: IntermediateTree,
  theirs: IntermediateTree,
  path: string,
  conflicts: string[],
): Promise<IntermediateTree> {
  const result: IntermediateTree = { entries: new Map(), deletions: new Set() };
  const names = new Set<string>();
  for (const side of [base, ours, theirs]) {
    for (const key of side.entries.keys()) names.add(key);
  }

  for (const name of names) {
    const b = base.entries.get(name);
    const o = ours.entries.get(name);
    const t = theirs.entries.get(name);
    const childPath = path ? `${path}/${name}` : name;

    if (entriesEqual(o, t)) {
      // Both sides agree (same content, or both deleted).
      if (o) result.entries.set(name, carryEntry(o));
      continue;
    }
    if (entriesEqual(o, b)) {
      // Ours unchanged — take theirs (includes deletion).
      if (t) result.entries.set(name, carryEntry(t));
      continue;
    }
    if (entriesEqual(t, b)) {
      // Theirs unchanged — take ours.
      if (o) result.entries.set(name, carryEntry(o));
      continue;
    }

    // Both sides diverged from base.
    if (o && t && o.kind === 'tree' && t.kind === 'tree' && b && b.kind === 'tree') {
      const mergedSub = await threeWayMerge(
        provider,
        env,
        repo,
        b.children,
        o.children,
        t.children,
        childPath,
        conflicts,
      );
      if (intermediateEqual(mergedSub, b.children)) {
        // Merging produced the base subtree unchanged — reuse its CID.
        result.entries.set(name, { kind: 'tree', name, children: { entries: new Map(), deletions: new Set() }, existingCid: b.existingCid });
      } else {
        result.entries.set(name, { kind: 'tree', name, children: mergedSub });
      }
      continue;
    }

    // Genuine conflict — record it and resolve in favour of ours (target).
    conflicts.push(childPath);
    if (o) result.entries.set(name, carryEntry(o));
    else if (t) result.entries.set(name, carryEntry(t));
  }

  return result;
}

/** Pin a fresh tree (no existing subtrees to merge). */
async function pinFreshTree(
  provider: StorageProvider,
  repo: GroupId,
  node: IntermediateTree,
): Promise<CID> {
  const treeEntries: Tree['entries'] = [];

  for (const entry of node.entries.values()) {
    if (entry.kind === 'blob') {
      treeEntries.push({ name: entry.name, cid: entry.cid, kind: 'blob', size: entry.size });
    } else {
      const childCid = await pinFreshTree(provider, repo, entry.children);
      treeEntries.push({ name: entry.name, cid: childCid, kind: 'tree' });
    }
  }

  const tree: Tree = { type: 'tree', entries: treeEntries };
  const upload = await pinJSON(provider, tree, repo);
  return upload.cid;
}
