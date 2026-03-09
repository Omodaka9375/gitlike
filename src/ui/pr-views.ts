// ---------------------------------------------------------------------------
// GitLike Pull Request Views
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, shortAddr, timeAgo, friendlyError } from './dom.js';
import type { Route } from './router.js';
import { refreshRoute } from './router.js';
import {
  fetchManifest,
  fetchJSON,
  hasSession,
  listPRs,
  createPR,
  updatePR,
  mergeBranches,
  fetchAlias,
} from '../api.js';
import { diffTrees, renderDiffView } from './diff.js';
import type { Tree, Commit, Manifest } from '../types.js';
import { renderBackToRepos } from './shared.js';
import { renderRepoHeader } from './repo-view.js';
import { showAlert } from './dialogs.js';

// ---------------------------------------------------------------------------
// Pull Request List View
// ---------------------------------------------------------------------------

export async function renderPRList(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading pull requests...'));

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const { prs } = await listPRs(route.groupId);

    const children: (HTMLElement | string)[] = [
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('h2', { cls: 'section-title', text: 'Pull Requests' }),
    ];

    if (hasSession()) {
      children.push(
        el('button', {
          cls: 'wallet-btn create-repo-btn',
          text: '+ New Pull Request',
          onclick: () => showCreatePRModal(route, manifest),
        }),
      );
    }

    if (prs.length === 0) {
      children.push(el('p', { cls: 'empty-state', text: 'No pull requests yet.' }));
    } else {
      const items = prs.map(({ cid, pr }) =>
        el('a', {
          cls: 'commit-item',
          attrs: { href: `/${route.groupId}/pr/${cid}` },
          children: [
            el('div', {
              cls: 'commit-item-header',
              children: [
                el('span', { cls: 'commit-message', text: pr.title }),
                el('span', {
                  cls: `badge ${pr.status === 'open' ? 'pr-open' : pr.status === 'merged' ? 'pr-merged' : 'pr-closed'}`,
                  text: pr.status,
                }),
              ],
            }),
            el('div', {
              cls: 'commit-item-meta',
              children: [
                el('span', { text: `${pr.sourceBranch} â†’ ${pr.targetBranch}` }),
                (() => {
                  const s = el('span', {
                    text: ` Â· ${shortAddr(pr.author)} Â· ${timeAgo(pr.createdAt)}`,
                  });
                  fetchAlias(pr.author).then((a) => {
                    if (a) s.textContent = ` Â· ${a} Â· ${timeAgo(pr.createdAt)}`;
                  });
                  return s;
                })(),
              ],
            }),
          ],
        }),
      );
      children.push(el('div', { cls: 'commit-list', children: items }));
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

/** Modal to create a new PR. */
function showCreatePRModal(route: Route, manifest: Manifest): void {
  document.getElementById('action-modal')?.remove();

  const branches = Object.keys(manifest.branches);
  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'New Pull Request' }),
      el('label', { text: 'Title', attrs: { for: 'pr-title' } }),
      el('input', { attrs: { id: 'pr-title', type: 'text', placeholder: 'Feature description' } }),
      el('label', { text: 'Source branch', attrs: { for: 'pr-source' } }),
      el('select', {
        attrs: { id: 'pr-source' },
        children: branches.map((b) => el('option', { text: b, attrs: { value: b } })),
      }),
      el('label', { text: 'Target branch', attrs: { for: 'pr-target' } }),
      el('select', {
        attrs: { id: 'pr-target' },
        children: branches.map((b) =>
          el('option', {
            text: b,
            attrs: { value: b, ...(b === manifest.defaultBranch ? { selected: 'selected' } : {}) },
          }),
        ),
      }),
      el('label', { text: 'Description (optional)', attrs: { for: 'pr-desc' } }),
      el('input', { attrs: { id: 'pr-desc', type: 'text', placeholder: 'Details...' } }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create PR',
            attrs: { id: 'pr-submit' },
            onclick: async () => {
              const title = (document.getElementById('pr-title') as HTMLInputElement)?.value.trim();
              if (!title) return;
              const source = (document.getElementById('pr-source') as HTMLSelectElement)?.value;
              const target = (document.getElementById('pr-target') as HTMLSelectElement)?.value;
              const desc = (document.getElementById('pr-desc') as HTMLInputElement)?.value.trim();
              const btn = document.getElementById('pr-submit') as HTMLButtonElement;
              const status = document.getElementById('modal-status');
              if (btn) btn.disabled = true;
              if (status) status.textContent = 'Creating...';
              try {
                await createPR(route.groupId, title, source, target, desc);
                if (status) {
                  status.textContent = '\u2713 PR created!';
                  status.className = 'modal-status success';
                }
                setTimeout(() => {
                  overlay.remove();
                  refreshRoute();
                }, 1000);
              } catch (err) {
                if (status) {
                  status.textContent = `Error: ${friendlyError(err)}`;
                  status.className = 'modal-status error';
                }
                if (btn) btn.disabled = false;
              }
            },
          }),
        ],
      }),
      el('div', { cls: 'modal-status', attrs: { id: 'modal-status' } }),
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Pull Request Detail View
// ---------------------------------------------------------------------------

export async function renderPRDetail(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading pull request...'));

  const cid = route.prCid;
  if (!cid) {
    render(root, errorBox('No PR identifier.'));
    return;
  }

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const pr = await fetchJSON<{
      type: string;
      title: string;
      description: string;
      author: string;
      sourceBranch: string;
      targetBranch: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>(String(cid));

    const children: (HTMLElement | string)[] = [
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('div', {
        cls: 'commit-detail-meta',
        children: [
          el('h2', { text: pr.title }),
          el('div', {
            cls: 'commit-item-meta',
            children: [
              el('span', {
                cls: `badge ${pr.status === 'open' ? 'pr-open' : pr.status === 'merged' ? 'pr-merged' : 'pr-closed'}`,
                text: pr.status,
              }),
              el('span', { text: ` ${pr.sourceBranch} â†’ ${pr.targetBranch}` }),
              (() => {
                const s = el('span', {
                  text: ` Â· ${shortAddr(pr.author)} Â· ${timeAgo(pr.createdAt)}`,
                });
                fetchAlias(pr.author).then((a) => {
                  if (a) s.textContent = ` Â· ${a} Â· ${timeAgo(pr.createdAt)}`;
                });
                return s;
              })(),
            ],
          }),
          pr.description ? el('p', { text: pr.description }) : el('span'),
        ],
      }),
    ];

    // Show diff between source and target branches
    const sourceCid = manifest.branches[pr.sourceBranch];
    const targetCid = manifest.branches[pr.targetBranch];
    if (sourceCid && targetCid) {
      const sourceCommit = await fetchJSON<Commit>(sourceCid);
      const targetCommit = await fetchJSON<Commit>(targetCid);
      const sourceTree = await fetchJSON<Tree>(sourceCommit.tree);
      const targetTree = await fetchJSON<Tree>(targetCommit.tree);
      const changes = await diffTrees(targetTree, sourceTree);
      children.push(await renderDiffView(changes));
    }

    // Action buttons for open PRs
    if (pr.status === 'open' && hasSession()) {
      children.push(
        el('div', {
          cls: 'modal-actions',
          children: [
            el('button', {
              cls: 'wallet-btn create-repo-btn',
              text: 'Merge & Close',
              onclick: async () => {
                try {
                  await mergeBranches(
                    route.groupId,
                    pr.sourceBranch,
                    pr.targetBranch,
                    `Merge PR: ${pr.title}`,
                  );
                  await updatePR(route.groupId, String(cid), 'merged');
                  refreshRoute();
                } catch (err) {
                  await showAlert(`Merge failed: ${friendlyError(err)}`);
                }
              },
            }),
            el('button', {
              cls: 'wallet-btn',
              text: 'Close',
              onclick: async () => {
                try {
                  await updatePR(route.groupId, String(cid), 'closed');
                  refreshRoute();
                } catch (err) {
                  await showAlert(`Close failed: ${friendlyError(err)}`);
                }
              },
            }),
          ],
        }),
      );
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}
