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

/** Check if a path contains a dot-directory segment. */
function hasDotDirectory(path: string): boolean {
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].startsWith('.')) return true;
  }
  return false;
}

/** Insert or delete a staged file in the intermediate tree. */
function applyFile(root: IntermediateTree, file: StagedFile): void {
  // Safety net — reject files inside dot-directories
  if (hasDotDirectory(file.path)) return;

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
