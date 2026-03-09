// ---------------------------------------------------------------------------
// GitLike — Diff Engine
// Tree-level and line-level diff with rendering.
// ---------------------------------------------------------------------------

import { el } from './dom.js';
import { fetchJSON, fetchText } from '../api.js';
import type { Tree } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChange = {
  path: string;
  kind: 'added' | 'removed' | 'modified';
  oldCid?: string;
  newCid?: string;
};

export type LineDiff = {
  type: 'add' | 'remove' | 'same';
  line: string;
};

// ---------------------------------------------------------------------------
// Tree diff — compare two trees recursively
// ---------------------------------------------------------------------------

/** Compare two trees and return a list of changed files. */
export async function diffTrees(oldTree: Tree, newTree: Tree, prefix = ''): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  const oldMap = new Map(oldTree.entries.map((e) => [e.name, e]));
  const newMap = new Map(newTree.entries.map((e) => [e.name, e]));

  // Removed entries
  for (const [name, entry] of oldMap) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (!newMap.has(name)) {
      if (entry.kind === 'blob') {
        changes.push({ path, kind: 'removed', oldCid: entry.cid });
      } else {
        const sub = await fetchJSON<Tree>(entry.cid);
        const subChanges = await collectAll(sub, path);
        for (const p of subChanges) changes.push({ path: p, kind: 'removed', oldCid: entry.cid });
      }
    }
  }

  // Added or modified entries
  for (const [name, entry] of newMap) {
    const path = prefix ? `${prefix}/${name}` : name;
    const old = oldMap.get(name);

    if (!old) {
      if (entry.kind === 'blob') {
        changes.push({ path, kind: 'added', newCid: entry.cid });
      } else {
        const sub = await fetchJSON<Tree>(entry.cid);
        const subChanges = await collectAll(sub, path);
        for (const p of subChanges) changes.push({ path: p, kind: 'added', newCid: entry.cid });
      }
    } else if (entry.cid !== old.cid) {
      if (entry.kind === 'blob' && old.kind === 'blob') {
        changes.push({ path, kind: 'modified', oldCid: old.cid, newCid: entry.cid });
      } else if (entry.kind === 'tree' && old.kind === 'tree') {
        const oldSub = await fetchJSON<Tree>(old.cid);
        const newSub = await fetchJSON<Tree>(entry.cid);
        const subChanges = await diffTrees(oldSub, newSub, path);
        changes.push(...subChanges);
      } else {
        changes.push({ path, kind: 'removed', oldCid: old.cid });
        changes.push({ path, kind: 'added', newCid: entry.cid });
      }
    }
  }

  return changes;
}

/** Collect all file paths from a tree recursively. */
async function collectAll(tree: Tree, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of tree.entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === 'blob') {
      paths.push(path);
    } else {
      const sub = await fetchJSON<Tree>(entry.cid);
      paths.push(...(await collectAll(sub, path)));
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Line diff — simple LCS-based diff
// ---------------------------------------------------------------------------

/** Max lines for LCS diff. Beyond this, show a "too large" placeholder. */
const MAX_DIFF_LINES = 5000;

/** Compute a line-level diff between two strings. */
export function diffLines(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Guard against huge files — LCS is O(M×N)
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return [
      {
        type: 'same',
        line: `[Diff too large: ${oldLines.length} + ${newLines.length} lines — skipped]`,
      },
    ];
  }

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: LineDiff[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Render diff
// ---------------------------------------------------------------------------

/** Render a list of file changes as a diff view. */
export async function renderDiffView(changes: FileChange[]): Promise<HTMLElement> {
  if (changes.length === 0) {
    return el('p', { cls: 'empty-state', text: 'No changes.' });
  }

  const container = el('div', { cls: 'diff-container' });

  // Summary
  const added = changes.filter((c) => c.kind === 'added').length;
  const removed = changes.filter((c) => c.kind === 'removed').length;
  const modified = changes.filter((c) => c.kind === 'modified').length;

  container.appendChild(
    el('div', {
      cls: 'diff-summary',
      children: [
        added > 0 ? el('span', { cls: 'diff-stat-add', text: `+${added} added` }) : el('span'),
        modified > 0
          ? el('span', { cls: 'diff-stat-mod', text: `~${modified} modified` })
          : el('span'),
        removed > 0 ? el('span', { cls: 'diff-stat-rm', text: `-${removed} removed` }) : el('span'),
      ],
    }),
  );

  // Individual file diffs
  for (const change of changes) {
    const header = el('div', {
      cls: `diff-file-header diff-${change.kind}`,
      text: `${change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~'} ${change.path}`,
    });

    const fileBlock = el('div', { cls: 'diff-file', children: [header] });

    // Show line diff for modified text files
    if (change.kind === 'modified' && change.oldCid && change.newCid) {
      try {
        const [oldContent, newContent] = await Promise.all([
          fetchText(change.oldCid),
          fetchText(change.newCid),
        ]);
        const lines = diffLines(oldContent, newContent);
        fileBlock.appendChild(renderLineDiff(lines));
      } catch {
        // Binary or fetch failed — skip line diff
      }
    }

    container.appendChild(fileBlock);
  }

  return container;
}

/** Render line-level diff as a pre block. */
function renderLineDiff(lines: LineDiff[]): HTMLElement {
  const rows = lines.map((l) => {
    const cls =
      l.type === 'add' ? 'diff-line-add' : l.type === 'remove' ? 'diff-line-rm' : 'diff-line';
    const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
    return el('div', { cls, text: `${prefix} ${l.line}` });
  });

  return el('pre', { cls: 'diff-lines', children: rows });
}
