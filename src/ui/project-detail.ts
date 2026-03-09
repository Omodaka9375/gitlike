// ---------------------------------------------------------------------------
// GitLike — Project Detail View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, friendlyError } from './dom.js';
import type { Route } from './router.js';
import { navigate } from './router.js';
import {
  resolveProjectSlug,
  fetchProject,
  updateProjectApi,
  deleteProjectApi,
  listRepos,
  slugify,
  hasSession,
} from '../api.js';
import type { ProjectDetail } from '../api.js';
import { connectedAddress } from '../wallet.js';
import { fillUserIdentity } from './user-identity.js';
import { repoCards } from './home.js';
import { showAlert, showConfirm } from './dialogs.js';

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export async function renderProjectDetail(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading project...'));

  const slug = route.projectSlug;
  if (!slug) {
    render(root, errorBox('No project specified.'));
    return;
  }

  try {
    const projectId = await resolveProjectSlug(slug);
    const project = await fetchProject(projectId);
    if (!project) {
      render(root, errorBox('Project not found.'));
      return;
    }

    const children: HTMLElement[] = [];

    // Header
    const isOwner = connectedAddress()?.toLowerCase() === project.owner.toLowerCase();
    const headerRight: HTMLElement[] = [];
    if (project.visibility === 'private') {
      headerRight.push(el('span', { cls: 'badge', text: '\uD83D\uDD12 Private' }));
    }
    headerRight.push(
      el('span', {
        cls: 'project-card-count',
        text: `${project.repos.length} repo${project.repos.length !== 1 ? 's' : ''}`,
      }),
    );

    children.push(
      el('div', {
        cls: 'repo-header',
        children: [
          el('div', {
            cls: 'repo-title-row',
            children: [el('h1', { text: project.name }), ...headerRight],
          }),
          project.description
            ? el('p', { cls: 'repo-desc', text: project.description })
            : el('span'),
          renderOwnerRow(project),
        ],
      }),
    );

    // Action bar for owner/admin
    if (isOwner && hasSession()) {
      children.push(
        el('div', {
          cls: 'action-bar',
          children: [
            el('button', {
              cls: 'action-btn',
              text: '\u270F\uFE0F Edit',
              onclick: () => showEditModal(project, slug),
            }),
            el('button', {
              cls: 'action-btn delete-btn',
              text: '\uD83D\uDDD1 Delete',
              onclick: () => handleDelete(project),
            }),
          ],
        }),
      );
    }

    // Repo grid
    if (project.repos.length > 0) {
      const repoContainer = el('div', {
        children: [spinner('Loading repositories...')],
      });
      children.push(el('h2', { cls: 'section-title', text: 'Repositories' }), repoContainer);
      loadProjectRepos(repoContainer, project.repos);
    } else {
      children.push(el('p', { cls: 'empty-state', text: 'No repositories in this project yet.' }));
    }

    render(root, ...children);
  } catch (err) {
    render(root, errorBox(`Failed to load project: ${friendlyError(err)}`));
  }
}

// ---------------------------------------------------------------------------
// Owner row
// ---------------------------------------------------------------------------

function renderOwnerRow(project: ProjectDetail): HTMLElement {
  const row = el('a', {
    cls: 'repo-owner-pill',
    attrs: { href: `/user/${project.owner}` },
  });
  fillUserIdentity(row, project.owner);
  return row;
}

// ---------------------------------------------------------------------------
// Load project repos
// ---------------------------------------------------------------------------

async function loadProjectRepos(container: HTMLElement, repoIds: string[]): Promise<void> {
  try {
    const { repos } = await listRepos(200);
    const memberRepos = repos.filter((r) => repoIds.includes(r.groupId));
    if (memberRepos.length === 0) {
      render(container, el('p', { cls: 'empty-state', text: 'No accessible repositories.' }));
      return;
    }
    render(container, el('div', { cls: 'repo-list', children: repoCards(memberRepos) }));
  } catch {
    render(container, el('p', { cls: 'empty-state', text: 'Could not load repositories.' }));
  }
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function showEditModal(project: ProjectDetail, currentSlug: string): void {
  document.getElementById('edit-project-modal')?.remove();

  const overlay = el('div', {
    cls: 'modal-overlay',
    attrs: { id: 'edit-project-modal' },
  });

  const nameInput = el('input', {
    attrs: { type: 'text', value: project.name, spellcheck: 'false' },
  }) as HTMLInputElement;

  const descInput = el('input', {
    attrs: { type: 'text', value: project.description, spellcheck: 'false' },
  }) as HTMLInputElement;

  const visSelect = el('select', {
    children: [
      el('option', { text: 'Public', attrs: { value: 'public' } }),
      el('option', { text: 'Private', attrs: { value: 'private' } }),
    ],
  }) as HTMLSelectElement;
  visSelect.value = project.visibility || 'public';

  const status = el('div', { cls: 'modal-status' });

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Edit Project' }),
      el('label', { text: 'Name' }),
      nameInput,
      el('label', { text: 'Description' }),
      descInput,
      el('label', { text: 'Visibility' }),
      visSelect,
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Save',
            attrs: { id: 'save-project-btn' },
            onclick: async () => {
              const btn = document.getElementById('save-project-btn') as HTMLButtonElement;
              btn.disabled = true;
              status.textContent = 'Saving...';
              status.className = 'modal-status';
              try {
                const patch: Record<string, string> = {};
                if (nameInput.value.trim() !== project.name) patch.name = nameInput.value.trim();
                if (descInput.value.trim() !== project.description)
                  patch.description = descInput.value.trim();
                const vis = visSelect.value as 'public' | 'private';
                if (vis !== (project.visibility || 'public')) patch.visibility = vis;
                await updateProjectApi(project.id, patch);
                status.textContent = '\u2713 Saved!';
                status.className = 'modal-status success';
                const newSlug = slugify(nameInput.value.trim() || project.name);
                setTimeout(() => {
                  overlay.remove();
                  navigate(`/projects/${newSlug || currentSlug}`);
                }, 800);
              } catch (err) {
                status.textContent = `Error: ${friendlyError(err)}`;
                status.className = 'modal-status error';
                btn.disabled = false;
              }
            },
          }),
        ],
      }),
      status,
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// Delete handler
// ---------------------------------------------------------------------------

async function handleDelete(project: ProjectDetail): Promise<void> {
  const confirmed = await showConfirm(
    `Delete project "${project.name}"? This will NOT delete the repos.`,
  );
  if (!confirmed) return;
  try {
    await deleteProjectApi(project.id);
    await showAlert('Project deleted.');
    navigate('/projects');
  } catch (err) {
    await showAlert(`Failed to delete: ${friendlyError(err)}`);
  }
}
