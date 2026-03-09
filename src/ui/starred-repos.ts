// ---------------------------------------------------------------------------
// GitLike — Starred Repos View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox } from './dom.js';
import type { Route } from './router.js';
import { getStarredRepos, fetchManifest } from '../api.js';
import type { RepoSummary } from '../api.js';
import { repoCards } from './home.js';
import { fillUserIdentity } from './user-identity.js';

/** Render the starred repos page for a given address. */
export async function renderStarredRepos(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading starred repos...'));

  const addr = route.address;
  if (!addr) {
    render(root, errorBox('No address.'));
    return;
  }

  try {
    const repoIds = await getStarredRepos(addr);

    const header = el('div', {
      cls: 'user-profile-header',
      attrs: {
        style:
          'display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; margin-top: 20px;',
      },
    });
    fillUserIdentity(header, addr, { size: 48 });

    const children: HTMLElement[] = [
      header,
      el('h2', { cls: 'section-title', text: `Starred Repositories (${repoIds.length})` }),
    ];

    if (repoIds.length === 0) {
      children.push(el('p', { cls: 'empty-state', text: 'No starred repositories yet.' }));
      render(root, ...children);
      return;
    }

    // Resolve manifests for each starred repo
    const repos: RepoSummary[] = [];
    await Promise.all(
      repoIds.map(async (id) => {
        try {
          const manifest = await fetchManifest(id);
          repos.push({ groupId: id, groupName: manifest?.name ?? id, manifest });
        } catch {
          // Repo may have been deleted — skip
        }
      }),
    );

    if (repos.length === 0) {
      children.push(el('p', { cls: 'empty-state', text: 'No accessible starred repositories.' }));
    } else {
      children.push(el('div', { cls: 'repo-list', children: repoCards(repos) }));
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}
