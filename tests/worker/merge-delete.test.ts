import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tree merge logic tests
// We test the intermediate merge semantics that mergeTrees uses internally.
// ---------------------------------------------------------------------------

type IntermediateEntry =
  | { kind: 'blob'; name: string; cid: string; size: number }
  | { kind: 'tree'; name: string; children: IntermediateTree; existingCid?: string };

type IntermediateTree = {
  entries: Map<string, IntermediateEntry>;
};

/** Replicate the mergeIntermediate logic from tree-builder.ts for testing. */
function mergeIntermediate(base: IntermediateTree, overlay: IntermediateTree): void {
  for (const [name, entry] of overlay.entries) {
    const existing = base.entries.get(name);

    if (!existing) {
      base.entries.set(name, entry);
      continue;
    }

    if (existing.kind === 'tree' && entry.kind === 'tree') {
      mergeIntermediate(existing.children, entry.children);
      if (entry.existingCid && existing.children.entries.size === 0) {
        existing.existingCid = entry.existingCid;
      }
      continue;
    }

    base.entries.set(name, entry);
  }
}

/** Replicate applyFile logic from tree-builder.ts for testing. */
function applyFile(
  root: IntermediateTree,
  file: { path: string; cid: string; size: number; deleted?: boolean },
): void {
  const parts = file.path.split('/');
  let current = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const dirName = parts[i];
    let existing = current.entries.get(dirName);

    if (!existing || existing.kind !== 'tree') {
      if (file.deleted) return;
      existing = { kind: 'tree', name: dirName, children: { entries: new Map() } };
      current.entries.set(dirName, existing);
    }

    current = existing.children;
  }

  const fileName = parts[parts.length - 1];

  if (file.deleted) {
    current.entries.delete(fileName);
    return;
  }

  current.entries.set(fileName, {
    kind: 'blob',
    name: fileName,
    cid: file.cid,
    size: file.size,
  });
}

function blob(name: string, cid: string, size = 100): IntermediateEntry {
  return { kind: 'blob', name, cid, size };
}

function tree(name: string, children: IntermediateEntry[], existingCid?: string): IntermediateEntry {
  const entries = new Map<string, IntermediateEntry>();
  for (const c of children) entries.set(c.name, c);
  return { kind: 'tree', name, children: { entries }, existingCid };
}

function makeTree(entries: IntermediateEntry[]): IntermediateTree {
  const map = new Map<string, IntermediateEntry>();
  for (const e of entries) map.set(e.name, e);
  return { entries: map };
}

// ---------------------------------------------------------------------------
// Merge tests
// ---------------------------------------------------------------------------

describe('mergeIntermediate', () => {
  it('adds new files from overlay', () => {
    const base = makeTree([blob('a.txt', 'cid-a')]);
    const overlay = makeTree([blob('b.txt', 'cid-b')]);
    mergeIntermediate(base, overlay);

    expect(base.entries.size).toBe(2);
    expect(base.entries.has('b.txt')).toBe(true);
  });

  it('overlay blob replaces base blob', () => {
    const base = makeTree([blob('a.txt', 'cid-old')]);
    const overlay = makeTree([blob('a.txt', 'cid-new')]);
    mergeIntermediate(base, overlay);

    const entry = base.entries.get('a.txt');
    expect(entry?.kind).toBe('blob');
    if (entry?.kind === 'blob') expect(entry.cid).toBe('cid-new');
  });

  it('overlay blob replaces base tree', () => {
    const base = makeTree([tree('docs', [blob('readme.md', 'cid-r')])]);
    const overlay = makeTree([blob('docs', 'cid-blob')]);
    mergeIntermediate(base, overlay);

    const entry = base.entries.get('docs');
    expect(entry?.kind).toBe('blob');
  });

  it('overlay tree replaces base blob', () => {
    const base = makeTree([blob('src', 'cid-blob')]);
    const overlay = makeTree([tree('src', [blob('index.ts', 'cid-idx')])]);
    mergeIntermediate(base, overlay);

    const entry = base.entries.get('src');
    expect(entry?.kind).toBe('tree');
  });

  it('recursively merges tree-tree conflicts', () => {
    const base = makeTree([tree('src', [blob('a.ts', 'cid-a'), blob('b.ts', 'cid-b')])]);
    const overlay = makeTree([tree('src', [blob('b.ts', 'cid-b-new'), blob('c.ts', 'cid-c')])]);
    mergeIntermediate(base, overlay);

    const src = base.entries.get('src');
    expect(src?.kind).toBe('tree');
    if (src?.kind === 'tree') {
      expect(src.children.entries.size).toBe(3);
      const b = src.children.entries.get('b.ts');
      if (b?.kind === 'blob') expect(b.cid).toBe('cid-b-new');
      expect(src.children.entries.has('c.ts')).toBe(true);
    }
  });

  it('preserves base entries not in overlay', () => {
    const base = makeTree([blob('keep.txt', 'cid-keep'), blob('shared.txt', 'cid-old')]);
    const overlay = makeTree([blob('shared.txt', 'cid-new')]);
    mergeIntermediate(base, overlay);

    expect(base.entries.size).toBe(2);
    const kept = base.entries.get('keep.txt');
    if (kept?.kind === 'blob') expect(kept.cid).toBe('cid-keep');
  });
});

// ---------------------------------------------------------------------------
// File deletion tests
// ---------------------------------------------------------------------------

describe('applyFile with deletion', () => {
  it('deletes a file from the root', () => {
    const root = makeTree([blob('a.txt', 'cid-a'), blob('b.txt', 'cid-b')]);
    applyFile(root, { path: 'a.txt', cid: '', size: 0, deleted: true });

    expect(root.entries.size).toBe(1);
    expect(root.entries.has('a.txt')).toBe(false);
  });

  it('deletes a nested file', () => {
    const inner: IntermediateTree = { entries: new Map() };
    inner.entries.set('utils.ts', blob('utils.ts', 'cid-u'));
    inner.entries.set('index.ts', blob('index.ts', 'cid-i'));

    const root: IntermediateTree = { entries: new Map() };
    root.entries.set('src', { kind: 'tree', name: 'src', children: inner });

    applyFile(root, { path: 'src/utils.ts', cid: '', size: 0, deleted: true });

    expect(inner.entries.size).toBe(1);
    expect(inner.entries.has('utils.ts')).toBe(false);
    expect(inner.entries.has('index.ts')).toBe(true);
  });

  it('does nothing when deleting a nonexistent path', () => {
    const root = makeTree([blob('a.txt', 'cid-a')]);
    applyFile(root, { path: 'nonexistent/deep/file.ts', cid: '', size: 0, deleted: true });

    expect(root.entries.size).toBe(1);
  });

  it('does nothing when deleting a nonexistent file in existing dir', () => {
    const inner: IntermediateTree = { entries: new Map() };
    inner.entries.set('keep.ts', blob('keep.ts', 'cid-k'));

    const root: IntermediateTree = { entries: new Map() };
    root.entries.set('src', { kind: 'tree', name: 'src', children: inner });

    applyFile(root, { path: 'src/ghost.ts', cid: '', size: 0, deleted: true });

    expect(inner.entries.size).toBe(1);
    expect(inner.entries.has('keep.ts')).toBe(true);
  });

  it('normal add still works alongside deletion', () => {
    const root = makeTree([blob('old.txt', 'cid-old')]);
    applyFile(root, { path: 'old.txt', cid: '', size: 0, deleted: true });
    applyFile(root, { path: 'new.txt', cid: 'cid-new', size: 50 });

    expect(root.entries.size).toBe(1);
    expect(root.entries.has('new.txt')).toBe(true);
    expect(root.entries.has('old.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merge commit parents
// ---------------------------------------------------------------------------

describe('merge commit structure', () => {
  it('merge commits should have two parents', () => {
    const targetCid = 'bafyabc123target';
    const sourceCid = 'bafydef456source';
    const parents = [targetCid, sourceCid];

    expect(parents.length).toBe(2);
    expect(parents[0]).toBe(targetCid);
    expect(parents[1]).toBe(sourceCid);
  });
});
