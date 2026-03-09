// ---------------------------------------------------------------------------
// GitLike — Project List View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox } from './dom.js';
import { listProjects, slugify } from '../api.js';
import type { ProjectSummary } from '../api.js';
import { fillUserIdentity } from './user-identity.js';

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export async function renderProjectList(root: HTMLElement): Promise<void> {
  render(root, spinner('Loading projects...'));

  const ownerFilter = new URLSearchParams(window.location.search).get('owner') ?? undefined;
  const title = ownerFilter ? 'My Projects' : 'Projects';

  try {
    const { projects } = await listProjects(ownerFilter);

    if (projects.length === 0) {
      render(
        root,
        el('h2', { cls: 'section-title', text: title }),
        el('p', {
          cls: 'empty-state',
          text: ownerFilter ? 'You have no projects yet.' : 'No projects yet.',
        }),
      );
      return;
    }

    render(
      root,
      el('h2', { cls: 'section-title', text: `${title} (${projects.length})` }),
      el('div', { cls: 'repo-list', children: projectCards(projects) }),
    );
  } catch (err) {
    render(root, errorBox(`Failed to load projects: ${err}`));
  }
}

// ---------------------------------------------------------------------------
// Project cards (reusable)
// ---------------------------------------------------------------------------

/** Build project card elements. Exported for use on the home page. */
export function projectCards(projects: ProjectSummary[]): HTMLElement[] {
  return projects.map((p) => {
    const slug = slugify(p.name);
    const ownerRow = el('div', { cls: 'repo-card-owner' });
    fillUserIdentity(ownerRow, p.owner);

    return el('a', {
      cls: 'project-card',
      attrs: { href: `/projects/${slug}` },
      children: [
        el('div', {
          cls: 'project-card-header',
          children: [
            el('span', { cls: 'project-card-name', text: p.name }),
            el('span', {
              cls: 'project-card-count',
              text: `${p.repoCount} repo${p.repoCount !== 1 ? 's' : ''}`,
            }),
          ],
        }),
        p.description ? el('p', { cls: 'project-card-desc', text: p.description }) : el('span'),
        ownerRow,
      ],
    });
  });
}
