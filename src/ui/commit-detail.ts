// ---------------------------------------------------------------------------
// GitLike Commit Detail View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, shortCid, timeAgo } from './dom.js';
import type { Route } from './router.js';
import { fetchManifest, fetchJSON } from '../api.js';
import { fillUserIdentity } from './user-identity.js';
import { diffTrees, renderDiffView } from './diff.js';
import type { Tree, Commit } from '../types.js';
import { renderBackToRepos } from './shared.js';
import { renderTreeTable } from './repo-view.js';

// ---------------------------------------------------------------------------
// Commit Detail View
// ---------------------------------------------------------------------------

export async function renderCommitDetail(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading commit...'));

  const cid = route.commitCid;
  if (!cid) {
    render(root, errorBox('No commit CID.'));
    return;
  }

  try {
    const commit = await fetchJSON<Commit>(cid);
    const manifest = await fetchManifest(route.groupId);

    let tree: Tree | null = null;
    let treePruned = false;
    try {
      tree = await fetchJSON<Tree>(commit.tree);
    } catch {
      treePruned = true;
    }

    const meta = el('div', {
      cls: 'commit-detail-meta',
      children: [
        el('h2', { text: commit.message }),
        el('div', {
          cls: 'commit-item-meta',
          children: [
            (() => {
              const a = el('a', {
                attrs: { href: `/user/${commit.author}` },
              });
              fillUserIdentity(a, commit.author);
              return a;
            })(),
            el('span', { text: ` committed ${timeAgo(commit.timestamp)}` }),
          ],
        }),
        el('div', {
          cls: 'commit-item-meta',
          children: [
            el('span', { text: `Commit: ${shortCid(cid)}` }),
            el('span', { text: ` | Tree: ${shortCid(commit.tree)}` }),
            commit.parents.length > 0
              ? el('span', {
                  children: [
                    el('span', { text: ' | Parent: ' }),
                    ...commit.parents.map((p) =>
                      el('a', {
                        text: shortCid(p),
                        attrs: { href: `/${route.slug}/commit/${p}` },
                      }),
                    ),
                  ],
                })
              : el('span', { text: ' | Initial commit' }),
          ],
        }),
      ],
    });

    const prunedNotice = el('div', {
      cls: 'pruned-notice',
      text: 'Snapshot pruned — file contents are no longer available for this commit.',
    });

    const children: (HTMLElement | string)[] = [renderBackToRepos(), meta];

    // Show diff against first parent (or pruned notice)
    if (commit.parents.length > 0 && tree) {
      try {
        const parentCommit = await fetchJSON<Commit>(commit.parents[0]);
        const parentTree = await fetchJSON<Tree>(parentCommit.tree);
        const changes = await diffTrees(parentTree, tree);
        children.push(await renderDiffView(changes));
      } catch {
        children.push(
          el('div', {
            cls: 'pruned-notice',
            text: 'Diff unavailable — parent snapshot has been pruned.',
          }),
        );
      }
    }

    // Show tree (or pruned notice)
    if (treePruned) {
      children.push(prunedNotice);
    } else if (tree && manifest) {
      const fakeRoute: Route = {
        view: 'repo',
        groupId: route.groupId,
        slug: route.slug,
        branch: '',
        path: '',
        segments: [],
      };
      children.push(el('h3', { cls: 'section-title', text: 'Files at this commit' }));
      children.push(renderTreeTable(tree, fakeRoute));
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}
