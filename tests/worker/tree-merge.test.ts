import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// buildMergedTree regression test — nested adds into existing directories must
// NOT drop pre-existing deeper content (b1.txt below).
//
// This mocks ../ipfs.js with an in-memory CID->object store so we can exercise
// the real buildMergedTree / applyFile / pinIntermediateTree logic.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();

// Deterministic pseudo-CID keyed by the serialized object so we can detect
// whether content is preserved by inspecting the produced tree structure.
function pseudoCid(obj: unknown): string {
  const json = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (h * 31 + json.charCodeAt(i)) >>> 0;
  }
  return 'cid-' + h.toString(36);
}

vi.mock('../../worker/ipfs.js', () => ({
  pinJSON: async (_provider: unknown, obj: unknown) => {
    const cid = pseudoCid(obj);
    store.set(cid, obj);
    return { cid };
  },
  fetchJSON: async (_env: unknown, cid: string) => {
    const obj = store.get(cid);
    if (obj === undefined) throw new Error(`missing object: ${cid}`);
    return obj;
  },
}));

// The real module under test (imports the mocked ipfs.js above).
const { buildMergedTree, mergeTrees3 } = await import('../../worker/tree-builder.js');

type Tree = {
  type: 'tree';
  entries: Array<{ name: string; cid: string; kind: 'blob' | 'tree'; size?: number }>;
};

async function loadTree(cid: string): Promise<Tree> {
  return store.get(cid) as Tree;
}

function find(tree: Tree, name: string) {
  return tree.entries.find((e) => e.name === name);
}

const dummyProvider = {};
const dummyEnv = {};

beforeEach(() => {
  store.clear();

  // Parent tree: a/{ keep.txt, b/{ b1.txt } }
  store.set('cid-keep', { name: 'keep.txt' });
  store.set('cid-b1', { name: 'b1.txt' });
  store.set('cid-c', { name: 'c.txt' });

  store.set('cid-b', {
    type: 'tree',
    entries: [
      { name: 'b1.txt', cid: 'cid-b1', kind: 'blob', size: 4 },
    ],
  });
  store.set('cid-a', {
    type: 'tree',
    entries: [
      { name: 'b', cid: 'cid-b', kind: 'tree' },
      { name: 'keep.txt', cid: 'cid-keep', kind: 'blob', size: 8 },
    ],
  });
  store.set('cid-root', {
    type: 'tree',
    entries: [{ name: 'a', cid: 'cid-a', kind: 'tree' }],
  });
});

describe('buildMergedTree nested-dir preservation', () => {
  it('keeps b1.txt when staging a file deeper inside an existing nested dir', async () => {
    const staged = [{ path: 'a/b/c.txt', cid: 'cid-c', size: 4 }];

    const rootCid = await buildMergedTree(
      dummyProvider,
      dummyEnv,
      'repo-1',
      store.get('cid-root') as Tree,
      staged,
    );

    const root = await loadTree(rootCid);
    const a = await loadTree(find(root, 'a')!.cid);
    const b = await loadTree(find(a, 'b')!.cid);

    const names = b.entries.map((e) => e.name).sort();
    expect(names).toEqual(['b1.txt', 'c.txt']); // pre-existing sibling preserved
    expect(find(a, 'keep.txt')).toBeDefined(); // untouched sibling preserved
  });

  it('keeps deeper content for >=3-level nested add', async () => {
    // a/b/c/{ c1.txt } ; stage a/b/c/d.txt
    store.set('cid-c1', { name: 'c1.txt' });
    store.set('cid-d', { name: 'd.txt' });
    store.set('cid-c3', {
      type: 'tree',
      entries: [{ name: 'c1.txt', cid: 'cid-c1', kind: 'blob', size: 4 }],
    });
    store.set('cid-a3', {
      type: 'tree',
      entries: [{ name: 'b', cid: 'cid-b3', kind: 'tree' }],
    });
    store.set('cid-b3', {
      type: 'tree',
      entries: [{ name: 'c', cid: 'cid-c3', kind: 'tree' }],
    });
    store.set('cid-root3', {
      type: 'tree',
      entries: [{ name: 'a', cid: 'cid-a3', kind: 'tree' }],
    });

    const staged = [{ path: 'a/b/c/d.txt', cid: 'cid-d', size: 4 }];
    const rootCid = await buildMergedTree(
      dummyProvider,
      dummyEnv,
      'repo-1',
      store.get('cid-root3') as Tree,
      staged,
    );

    const root = await loadTree(rootCid);
    const a = await loadTree(find(root, 'a')!.cid);
    const b = await loadTree(find(a, 'b')!.cid);
    const c = await loadTree(find(b, 'c')!.cid);
    expect(c.entries.map((e) => e.name).sort()).toEqual(['c1.txt', 'd.txt']);
  });
});

describe('mergeTrees3 three-way merge', () => {
  // Shared helpers to seed base/ours/theirs trees in the store.
  function seedTrees(
    base: Tree,
    ours: Tree,
    theirs: Tree,
  ): { baseCid: string; oursCid: string; theirsCid: string } {
    store.set('f-a', { name: 'a' });
    store.set('f-b', { name: 'b' });
    store.set('f-c', { name: 'c' });
    store.set('f-d', { name: 'd' });
    const baseCid = pseudoCid(base);
    store.set(baseCid, base);
    const oursCid = pseudoCid(ours);
    store.set(oursCid, ours);
    const theirsCid = pseudoCid(theirs);
    store.set(theirsCid, theirs);
    return { baseCid, oursCid, theirsCid };
  }

  it('honors a file deleted on the source branch (no resurrection)', async () => {
    // base: a.txt, b.txt ; ours (target): a.txt, b.txt ; theirs (source): b.txt only (a.txt deleted)
    const base: Tree = {
      type: 'tree',
      entries: [
        { name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 },
        { name: 'b.txt', cid: 'f-b', kind: 'blob', size: 1 },
      ],
    };
    const ours: Tree = {
      type: 'tree',
      entries: [
        { name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 },
        { name: 'b.txt', cid: 'f-b', kind: 'blob', size: 1 },
      ],
    };
    const theirs: Tree = {
      type: 'tree',
      entries: [{ name: 'b.txt', cid: 'f-b', kind: 'blob', size: 1 }],
    };
    const { baseCid, oursCid, theirsCid } = seedTrees(base, ours, theirs);

    const { cid, conflicts } = await mergeTrees3(
      dummyProvider,
      dummyEnv,
      'repo-m',
      store.get(baseCid) as Tree,
      store.get(oursCid) as Tree,
      store.get(theirsCid) as Tree,
    );

    const merged = await loadTree(cid);
    expect(merged.entries.map((e) => e.name)).toEqual(['b.txt']); // a.txt deleted, not resurrected
    expect(conflicts).toEqual([]);
  });

  it('takes a clean one-sided source change without conflict', async () => {
    // base: only a.txt; ours (target): only a.txt; theirs (source): a.txt + c.txt (new)
    const base: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 }],
    };
    const ours: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 }],
    };
    const theirs: Tree = {
      type: 'tree',
      entries: [
        { name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 },
        { name: 'c.txt', cid: 'f-c', kind: 'blob', size: 1 },
      ],
    };
    const { baseCid, oursCid, theirsCid } = seedTrees(base, ours, theirs);

    const { cid, conflicts } = await mergeTrees3(
      dummyProvider,
      dummyEnv,
      'repo-m',
      store.get(baseCid) as Tree,
      store.get(oursCid) as Tree,
      store.get(theirsCid) as Tree,
    );

    const merged = await loadTree(cid);
    expect(merged.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'c.txt']);
    expect(conflicts).toEqual([]); // clean one-sided change — not a conflict
  });

  it('reports a conflict only when both sides changed the same file', async () => {
    // base: a.txt (v0); ours: a.txt (v0->v1); theirs: a.txt (v0->different)
    const base: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 }],
    };
    store.set('v-ours', { name: 'ours' });
    store.set('v-theirs', { name: 'theirs' });
    const ours: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'v-ours', kind: 'blob', size: 1 }],
    };
    const theirs: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'v-theirs', kind: 'blob', size: 1 }],
    };
    const { baseCid, oursCid, theirsCid } = seedTrees(base, ours, theirs);

    const { cid, conflicts } = await mergeTrees3(
      dummyProvider,
      dummyEnv,
      'repo-m',
      store.get(baseCid) as Tree,
      store.get(oursCid) as Tree,
      store.get(theirsCid) as Tree,
    );

    expect(conflicts).toEqual(['a.txt']);
    const merged = await loadTree(cid);
    // resolves in favour of ours (target); file still present
    expect(merged.entries.find((e) => e.name === 'a.txt')).toBeDefined();
  });

  it('keeps independent additions from both branches', async () => {
    // base: empty; ours adds a.txt; theirs adds b.txt
    const base: Tree = { type: 'tree', entries: [] };
    const ours: Tree = {
      type: 'tree',
      entries: [{ name: 'a.txt', cid: 'f-a', kind: 'blob', size: 1 }],
    };
    const theirs: Tree = {
      type: 'tree',
      entries: [{ name: 'b.txt', cid: 'f-b', kind: 'blob', size: 1 }],
    };
    const { baseCid, oursCid, theirsCid } = seedTrees(base, ours, theirs);

    const { cid, conflicts } = await mergeTrees3(
      dummyProvider,
      dummyEnv,
      'repo-m',
      store.get(baseCid) as Tree,
      store.get(oursCid) as Tree,
      store.get(theirsCid) as Tree,
    );

    const merged = await loadTree(cid);
    expect(merged.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    expect(conflicts).toEqual([]);
  });
});
