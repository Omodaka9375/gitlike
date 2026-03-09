// ---------------------------------------------------------------------------
// GitLike File History View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox } from './dom.js';
import type { Route } from './router.js';
import { fetchManifest, fetchJSON, walkCommitHistory } from '../api.js';
import type { Tree } from '../types.js';
import { renderBackToRepos } from './shared.js';
import { renderRepoHeader, renderCommitList } from './repo-view.js';

// ---------------------------------------------------------------------------
// File History View
// ---------------------------------------------------------------------------

export async function renderFileHistory(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading file history...'));

  if (!route.path) {
    render(root, errorBox('No file path specified.'));
    return;
  }

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const headCid = manifest.branches[route.branch];
    if (!headCid) {
      render(root, errorBox(`Branch "${route.branch}" not found.`));
      return;
    }

    const allCommits = await walkCommitHistory(headCid, 100);

    // Filter to commits that changed this file path
    const relevant: typeof allCommits = [];
    for (let i = 0; i < allCommits.length; i++) {
      const { commit } = allCommits[i];
      const tree = await fetchJSON<Tree>(commit.tree);
      const fileCid = await resolveFileCid(tree, route.segments);

      if (i === 0) {
        if (fileCid) relevant.push(allCommits[i]);
        continue;
      }

      // Compare with previous commit's tree
      const prevCommit = allCommits[i - 1].commit;
      const prevTree = await fetchJSON<Tree>(prevCommit.tree);
      const prevCid = await resolveFileCid(prevTree, route.segments);

      if (fileCid !== prevCid) relevant.push(allCommits[i]);
    }

    render(
      root,
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('p', { cls: 'history-path', text: `History of ${route.path}` }),
      relevant.length > 0
        ? renderCommitList(relevant, route.slug, route.groupId)
        : el('p', { cls: 'empty-state', text: 'No history found for this file.' }),
    );
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

/** Resolve a file path through nested trees to get its CID (or undefined). */
async function resolveFileCid(tree: Tree, segments: string[]): Promise<string | undefined> {
  let current = tree;
  for (let i = 0; i < segments.length; i++) {
    const entry = current.entries.find((e) => e.name === segments[i]);
    if (!entry) return undefined;
    if (i === segments.length - 1) return entry.cid;
    if (entry.kind === 'tree') {
      current = await fetchJSON<Tree>(entry.cid);
    } else {
      return undefined;
    }
  }
  return undefined;
}
