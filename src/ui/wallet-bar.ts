// ---------------------------------------------------------------------------
// GitLike — Wallet Bar
// Persistent top bar: connect wallet, show address, create repo.
// ---------------------------------------------------------------------------

import { el, friendlyError } from './dom.js';

// ---------------------------------------------------------------------------
// SVG icon markup (16×16, stroked with currentColor for CSS theming)
// ---------------------------------------------------------------------------
const ICON_SUN =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>';
const ICON_MOON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"/></svg>';
const ICON_HOME =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l6-5.5L14 8"/><path d="M3.5 9v4.5h3.25V11h2.5v2.5h3.25V9"/></svg>';
const ICON_HAMBURGER =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg>';
const ICON_PLUS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
import { showAlert } from './dialogs.js';
import {
  connect,
  disconnect,
  connectedAddress,
  hasInjectedProvider,
  authenticateWithSiwe,
} from '../wallet.js';
import {
  createRepo,
  parseRepoUrl,
  importFromGitHub,
  hasSession,
  fetchLicenses,
  fetchPlatformSettings,
  createProjectApi,
  listRepos,
  slugify,
} from '../api.js';
import { buildPath, navigate, currentRoute } from './router.js';
import { fillUserIdentity } from './user-identity.js';
import { showPlatformSettingsModal } from './platform-settings.js';

/** Render the wallet bar. Re-call to refresh state. */
export function renderWalletBar(): HTMLElement {
  const address = connectedAddress();

  // Navigation links — highlight the active page
  const route = currentRoute();
  const navLinks: HTMLElement[] = [
    el('a', {
      cls: `topbar-link${route.view === 'how' ? ' active' : ''}`,
      text: 'For Humans',
      attrs: { href: '/humans' },
    }),
    el('a', {
      cls: `topbar-link${route.view === 'agents' ? ' active' : ''}`,
      text: 'For Agents',
      attrs: { href: '/agents' },
    }),
    el('a', {
      cls: `topbar-link${route.view === 'run-your-own' ? ' active' : ''}`,
      text: 'Run Your Own',
      attrs: { href: '/run-your-own' },
    }),
    el('a', {
      cls: `topbar-link${route.view === 'cli' ? ' active' : ''}`,
      text: 'CLI',
      attrs: { href: '/cli' },
    }),
    el('a', {
      cls: `topbar-link${route.view === 'about' ? ' active' : ''}`,
      text: 'About',
      attrs: { href: '/about' },
    }),
  ];

  const nav = el('nav', { cls: 'topbar-nav', children: navLinks });

  // Hamburger button for mobile nav
  const hamburgerBtn = el('button', {
    cls: 'topbar-hamburger',
    html: ICON_HAMBURGER,
    attrs: { title: 'Toggle navigation' },
  });
  hamburgerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = nav.classList.toggle('open');
    if (isOpen) {
      const closeNav = (ev: MouseEvent) => {
        if (!nav.contains(ev.target as Node) && !hamburgerBtn.contains(ev.target as Node)) {
          nav.classList.remove('open');
          document.removeEventListener('click', closeNav);
        }
      };
      requestAnimationFrame(() => document.addEventListener('click', closeNav));
    }
  });
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.topbar-link')) nav.classList.remove('open');
  });

  // "+" create dropdown — hidden until platform settings confirm permissions
  const createDropdown = buildCreateDropdown();

  // Role badge — populated async by loadPlatformState
  const roleBadge = el('span', { cls: 'role-tag hidden' });

  // Fetch platform settings async to show/hide create dropdown
  if (address && hasSession()) {
    loadPlatformState(createDropdown, roleBadge);
  }

  // Auth section
  const authChildren = address ? connectedChildren(address, roleBadge) : disconnectedChildren();
  const auth = el('div', {
    cls: 'topbar-auth',
    children: authChildren,
  });

  // Right side: create dropdown + auth (+ theme toggle for disconnected users)
  const rightChildren: HTMLElement[] = [];
  if (address && hasSession()) rightChildren.push(createDropdown);
  rightChildren.push(auth);
  if (!address) rightChildren.push(buildThemeToggleBtn());

  return el('div', {
    cls: 'wallet-bar',
    children: [
      el('div', {
        cls: 'wallet-bar-inner',
        children: [
          el('a', {
            cls: `topbar-icon-btn${route.view === 'home' ? ' active' : ''}`,
            html: ICON_HOME,
            attrs: { href: '/', title: 'Home' },
          }),
          hamburgerBtn,
          nav,
          el('div', { cls: 'topbar-right', children: rightChildren }),
        ],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Disconnected state
// ---------------------------------------------------------------------------

function disconnectedChildren(): HTMLElement[] {
  const children: HTMLElement[] = [];

  if (!hasInjectedProvider()) {
    children.push(el('span', { cls: 'wallet-hint', text: 'No wallet detected' }));
    return children;
  }

  children.push(
    el('button', {
      cls: 'wallet-btn connect-btn',
      text: '🔗 Connect Wallet',
      onclick: handleConnect,
    }),
  );

  return children;
}

// ---------------------------------------------------------------------------
// Connected state
// ---------------------------------------------------------------------------

function connectedChildren(address: string, roleBadge: HTMLElement): HTMLElement[] {
  // Admin settings menu item — hidden until loadPlatformState reveals it
  const adminItem = el('button', {
    cls: 'user-menu-item hidden',
    text: 'Settings',
    attrs: { id: 'admin-settings-btn' },
    onclick: showPlatformSettingsModal,
  });

  // Theme toggle menu item
  const isLight = document.documentElement.dataset.theme === 'light';
  const themeItem = el('button', {
    cls: 'user-menu-item',
    text: isLight ? '\u2600 Switch to Dark' : '\uD83C\uDF19 Switch to Light',
    onclick: () => {
      const light = document.documentElement.dataset.theme === 'light';
      const next = light ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('gitlike_theme', next);
      themeItem.textContent =
        next === 'light' ? '\u2600 Switch to Dark' : '\uD83C\uDF19 Switch to Light';
    },
  });

  // Dropdown menu items
  const menu = el('div', {
    cls: 'user-menu',
    children: [
      el('a', {
        cls: 'user-menu-item',
        text: 'My Profile',
        attrs: { href: `/user/${address}` },
      }),
      el('a', {
        cls: 'user-menu-item',
        text: 'My Stars',
        attrs: { href: `/user/${address}/stars` },
      }),
      el('a', {
        cls: 'user-menu-item',
        text: 'My Projects',
        attrs: { href: `/projects?owner=${address}` },
      }),
      el('div', { cls: 'user-menu-divider' }),
      themeItem,
      adminItem,
      el('button', {
        cls: 'user-menu-item user-menu-danger',
        text: 'Disconnect',
        onclick: handleDisconnect,
      }),
    ],
  });

  // Trigger button — shows avatar + name, toggles dropdown
  const trigger = el('button', {
    cls: 'wallet-address',
    attrs: { title: address },
  });
  fillUserIdentity(trigger, address);

  // Role badge + chevron indicator
  trigger.appendChild(roleBadge);
  trigger.appendChild(el('span', { cls: 'user-menu-chevron', text: '\u25BE' }));

  const wrapper = el('div', {
    cls: 'user-menu-wrapper',
    children: [trigger, menu],
  });

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = wrapper.classList.toggle('open');
    if (open) {
      // Close on next outside click
      const close = (ev: MouseEvent) => {
        if (!wrapper.contains(ev.target as Node)) {
          wrapper.classList.remove('open');
          document.removeEventListener('click', close);
        }
      };
      // Defer so this click doesn't immediately close it
      requestAnimationFrame(() => document.addEventListener('click', close));
    }
  });

  return [wrapper];
}

// ---------------------------------------------------------------------------
// Theme toggle (shown in topbar only when disconnected)
// ---------------------------------------------------------------------------

/** Build theme toggle icon button for disconnected topbar. */
function buildThemeToggleBtn(): HTMLElement {
  const isLight = document.documentElement.dataset.theme === 'light';
  const btn = el('button', {
    cls: 'topbar-icon-btn',
    html: isLight ? ICON_MOON : ICON_SUN,
    attrs: { title: 'Toggle theme' },
    onclick: () => {
      const light = document.documentElement.dataset.theme === 'light';
      const next = light ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('gitlike_theme', next);
      btn.innerHTML = next === 'light' ? ICON_MOON : ICON_SUN;
    },
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleConnect(): Promise<void> {
  try {
    await connect();
    // Authenticate with SIWE after wallet connection
    try {
      await authenticateWithSiwe();
    } catch (err) {
      console.warn('SIWE auth failed (read-only mode):', err);
    }
    refreshBar();
  } catch (err) {
    await showAlert(`Failed to connect: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleDisconnect(): Promise<void> {
  await disconnect();
  refreshBar();
}

// ---------------------------------------------------------------------------
// Platform state loader
// ---------------------------------------------------------------------------

/** Fetch platform settings and show/hide create dropdown + admin menu item. */
async function loadPlatformState(
  createDropdown: HTMLElement,
  roleBadge: HTMLElement,
): Promise<void> {
  try {
    const { role, settings } = await fetchPlatformSettings();
    if (role === 'admin' || settings.openCreation || role === 'writer') {
      createDropdown.classList.remove('hidden');
    }
    if (role === 'admin') {
      document.getElementById('admin-settings-btn')?.classList.remove('hidden');
    }
    // Show role badge
    const roleLabel = role === 'writer' ? 'developer' : role;
    roleBadge.textContent = roleLabel;
    roleBadge.classList.add(`role-tag-${role}`);
    roleBadge.classList.remove('hidden');
  } catch {
    // Fallback: show dropdown (backwards-compatible)
    createDropdown.classList.remove('hidden');
  }
}

/** Build the "+" create dropdown with New Repository and New Project items. */
function buildCreateDropdown(): HTMLElement {
  const trigger = el('button', {
    cls: 'create-menu-trigger',
    html: ICON_PLUS,
    attrs: { title: 'Create new\u2026' },
  });

  const menu = el('div', {
    cls: 'create-menu',
    children: [
      el('button', {
        cls: 'user-menu-item',
        text: 'New Repository',
        onclick: showCreateRepoModal,
      }),
      el('button', {
        cls: 'user-menu-item',
        text: 'New Project',
        onclick: showCreateProjectModal,
      }),
    ],
  });

  const wrapper = el('div', {
    cls: 'create-menu-wrapper hidden',
    children: [trigger, menu],
  });

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = wrapper.classList.toggle('open');
    if (open) {
      const close = (ev: MouseEvent) => {
        if (!wrapper.contains(ev.target as Node)) {
          wrapper.classList.remove('open');
          document.removeEventListener('click', close);
        }
      };
      requestAnimationFrame(() => document.addEventListener('click', close));
    }
  });

  // Close dropdown when a menu item is clicked
  menu.addEventListener('click', () => wrapper.classList.remove('open'));

  return wrapper;
}

/** Swap the wallet bar in place without re-rendering the whole page. */
function refreshBar(): void {
  const existing = document.querySelector('.wallet-bar');
  if (!existing?.parentElement) return;
  const parent = existing.parentElement;
  const newBar = renderWalletBar();
  parent.replaceChild(newBar, existing);
}

// Re-render bar when platform settings change
window.addEventListener('platform-settings-changed', () => refreshBar());

// ---------------------------------------------------------------------------
// Create Repo Modal
// ---------------------------------------------------------------------------

function showCreateRepoModal(): void {
  document.getElementById('create-repo-modal')?.remove();

  const overlay = el('div', {
    cls: 'modal-overlay',
    attrs: { id: 'create-repo-modal' },
  });

  // --- Tab state ---
  let activeTab: 'blank' | 'import' = 'blank';

  const blankTab = el('button', {
    cls: 'modal-tab active',
    text: 'Blank Repo',
    attrs: { id: 'tab-blank' },
    onclick: () => switchTab('blank'),
  });
  const importTab = el('button', {
    cls: 'modal-tab',
    text: 'Import from GitHub / GitLab',
    attrs: { id: 'tab-import' },
    onclick: () => switchTab('import'),
  });

  const blankPane = el('div', {
    cls: 'tab-pane',
    attrs: { id: 'pane-blank' },
    children: [
      el('label', { text: 'Name', attrs: { for: 'repo-name' } }),
      el('input', {
        attrs: {
          id: 'repo-name',
          type: 'text',
          placeholder: 'my-project',
          spellcheck: 'false',
          autofocus: 'true',
        },
      }),
      el('label', { text: 'Description (optional)', attrs: { for: 'repo-desc' } }),
      el('input', {
        attrs: {
          id: 'repo-desc',
          type: 'text',
          placeholder: 'A short description...',
          spellcheck: 'false',
        },
      }),
      el('label', { text: 'Visibility', attrs: { for: 'repo-visibility' } }),
      el('select', {
        attrs: { id: 'repo-visibility' },
        children: [
          el('option', { text: 'Public', attrs: { value: 'public' } }),
          el('option', { text: 'Private', attrs: { value: 'private' } }),
        ],
      }),
      el('label', { text: 'License', attrs: { for: 'repo-license' } }),
      el('select', {
        attrs: { id: 'repo-license' },
        children: [el('option', { text: 'Loading...', attrs: { value: 'NOL' } })],
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: 'Cancel',
            onclick: () => overlay.remove(),
          }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create',
            attrs: { id: 'create-repo-submit' },
            onclick: () => handleCreateRepo(overlay),
          }),
        ],
      }),
    ],
  });

  const importPane = el('div', {
    cls: 'tab-pane hidden',
    attrs: { id: 'pane-import' },
    children: [
      el('label', { text: 'Repository URL', attrs: { for: 'import-url' } }),
      el('input', {
        attrs: {
          id: 'import-url',
          type: 'text',
          placeholder: 'https://github.com/owner/repo or https://gitlab.com/owner/repo',
          spellcheck: 'false',
        },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: 'Cancel',
            onclick: () => overlay.remove(),
          }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Import',
            attrs: { id: 'import-submit' },
            onclick: () => handleImportRepo(overlay),
          }),
        ],
      }),
    ],
  });

  function switchTab(tab: 'blank' | 'import'): void {
    activeTab = tab;
    blankTab.className = `modal-tab${activeTab === 'blank' ? ' active' : ''}`;
    importTab.className = `modal-tab${activeTab === 'import' ? ' active' : ''}`;
    blankPane.className = `tab-pane${activeTab === 'blank' ? '' : ' hidden'}`;
    importPane.className = `tab-pane${activeTab === 'import' ? '' : ' hidden'}`;
    // Clear status on tab switch
    const status = document.getElementById('modal-status');
    if (status) {
      status.textContent = '';
      status.className = 'modal-status';
    }
  }

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'New Repository' }),
      el('div', { cls: 'modal-tabs', children: [blankTab, importTab] }),
      blankPane,
      importPane,
      el('div', { cls: 'modal-status', attrs: { id: 'modal-status' } }),
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  (document.getElementById('repo-name') as HTMLInputElement)?.focus();

  // Populate license dropdown asynchronously
  loadLicenseOptions();
}

/** Populate the license <select> from the API. */
async function loadLicenseOptions(): Promise<void> {
  const select = document.getElementById('repo-license') as HTMLSelectElement;
  if (!select) return;
  const licenses = await fetchLicenses();
  select.innerHTML = '';
  for (const lic of licenses) {
    const opt = el('option', { text: lic.name, attrs: { value: lic.id } });
    select.appendChild(opt);
  }
}

async function handleCreateRepo(overlay: HTMLElement): Promise<void> {
  const nameInput = document.getElementById('repo-name') as HTMLInputElement;
  const descInput = document.getElementById('repo-desc') as HTMLInputElement;
  const status = document.getElementById('modal-status');
  const submitBtn = document.getElementById('create-repo-submit') as HTMLButtonElement;

  const name = nameInput?.value.trim();
  if (!name) {
    if (status) status.textContent = 'Name is required.';
    return;
  }

  const visSelect = document.getElementById('repo-visibility') as HTMLSelectElement;
  const visibility = (visSelect?.value as 'public' | 'private') || 'public';
  const licSelect = document.getElementById('repo-license') as HTMLSelectElement;
  const license = licSelect?.value || 'NOL';

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.textContent = 'Creating repo...';
      status.className = 'modal-status';
    }

    const { groupId } = await createRepo(name, descInput?.value.trim() ?? '', visibility, license);

    if (status) {
      status.textContent = `\u2713 Created! Group ID: ${groupId}`;
      status.className = 'modal-status success';
    }

    setTimeout(() => {
      overlay.remove();
      navigate(buildPath(groupId));
    }, 1200);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Create Project Modal
// ---------------------------------------------------------------------------

/** Repo item for the project modal — either an existing repo or a new one to create. */
type ProjectRepoItem =
  | { kind: 'existing'; groupId: string; name: string }
  | { kind: 'new'; name: string; description: string };

function showCreateProjectModal(): void {
  document.getElementById('create-project-modal')?.remove();

  const overlay = el('div', {
    cls: 'modal-overlay',
    attrs: { id: 'create-project-modal' },
  });

  const repoItems: ProjectRepoItem[] = [];
  const repoListEl = el('div', { cls: 'project-repo-list' });

  /** Render the repo list. */
  function renderRepoItems(): void {
    repoListEl.innerHTML = '';
    if (repoItems.length === 0) {
      repoListEl.appendChild(
        el('p', { cls: 'modal-hint', text: 'Add existing repos or create new ones below.' }),
      );
      return;
    }
    repoItems.forEach((item, i) => {
      const label = item.kind === 'existing' ? item.name : `\u2728 ${item.name} (new)`;
      const row = el('div', {
        cls: 'project-repo-entry',
        children: [
          el('span', { cls: 'project-repo-name', text: label }),
          el('button', {
            cls: 'topbar-icon-btn project-repo-remove',
            text: '\u2715',
            attrs: { title: 'Remove' },
            onclick: () => {
              repoItems.splice(i, 1);
              renderRepoItems();
            },
          }),
        ],
      });
      repoListEl.appendChild(row);
    });
  }

  renderRepoItems();

  // Existing repo picker
  const pickerContainer = el('div', { cls: 'project-repo-list' });
  let allRepos: Array<{ groupId: string; name: string }> = [];
  let pickerLoaded = false;

  async function loadRepoPicker(): Promise<void> {
    if (pickerLoaded) return;
    pickerLoaded = true;
    try {
      const { repos } = await listRepos(200);
      allRepos = repos
        .filter((r) => r.manifest)
        .map((r) => ({ groupId: r.groupId, name: r.manifest!.name }));
    } catch {
      /* skip */
    }
  }

  function showRepoPicker(): void {
    pickerContainer.innerHTML = '';
    const searchInput = el('input', {
      cls: 'repo-search-input',
      attrs: { type: 'text', placeholder: 'Search your repos\u2026', spellcheck: 'false' },
    }) as HTMLInputElement;
    const resultsList = el('div', { cls: 'project-repo-list' });

    function filterResults(q: string): void {
      resultsList.innerHTML = '';
      const existing = new Set(
        repoItems.filter((r) => r.kind === 'existing').map((r) => r.groupId),
      );
      const matches = allRepos
        .filter((r) => !existing.has(r.groupId))
        .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8);
      if (matches.length === 0) {
        resultsList.appendChild(el('p', { cls: 'modal-hint', text: 'No matching repos.' }));
        return;
      }
      for (const repo of matches) {
        resultsList.appendChild(
          el('button', {
            cls: 'wallet-btn',
            text: repo.name,
            attrs: { style: 'width:100%; justify-content:flex-start;' },
            onclick: () => {
              repoItems.push({ kind: 'existing', groupId: repo.groupId, name: repo.name });
              renderRepoItems();
              pickerContainer.innerHTML = '';
            },
          }),
        );
      }
    }

    searchInput.addEventListener('input', () => filterResults(searchInput.value.trim()));
    pickerContainer.appendChild(searchInput);
    pickerContainer.appendChild(resultsList);
    filterResults('');
    searchInput.focus();
  }

  // New repo inline form
  function showNewRepoForm(): void {
    pickerContainer.innerHTML = '';
    const nameIn = el('input', {
      attrs: { type: 'text', placeholder: 'New repo name', spellcheck: 'false' },
    }) as HTMLInputElement;
    const descIn = el('input', {
      attrs: { type: 'text', placeholder: 'Description (optional)', spellcheck: 'false' },
    }) as HTMLInputElement;
    pickerContainer.appendChild(
      el('div', {
        cls: 'project-repo-entry',
        children: [
          nameIn,
          descIn,
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Add',
            onclick: () => {
              const n = nameIn.value.trim();
              if (!n) return;
              repoItems.push({ kind: 'new', name: n, description: descIn.value.trim() });
              renderRepoItems();
              pickerContainer.innerHTML = '';
            },
          }),
        ],
      }),
    );
    nameIn.focus();
  }

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'New Project' }),
      el('label', { text: 'Project Name', attrs: { for: 'project-name' } }),
      el('input', {
        attrs: {
          id: 'project-name',
          type: 'text',
          placeholder: 'my-project',
          spellcheck: 'false',
          autofocus: 'true',
        },
      }),
      el('label', { text: 'Description (optional)', attrs: { for: 'project-desc' } }),
      el('input', {
        attrs: {
          id: 'project-desc',
          type: 'text',
          placeholder: 'A short project description...',
          spellcheck: 'false',
        },
      }),
      el('label', { text: 'Visibility', attrs: { for: 'project-visibility' } }),
      el('select', {
        attrs: { id: 'project-visibility' },
        children: [
          el('option', { text: 'Public', attrs: { value: 'public' } }),
          el('option', { text: 'Private', attrs: { value: 'private' } }),
        ],
      }),
      el('label', { text: 'Repositories' }),
      repoListEl,
      el('div', {
        cls: 'modal-row',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: '+ Add Existing Repo',
            onclick: async () => {
              await loadRepoPicker();
              showRepoPicker();
            },
          }),
          el('button', {
            cls: 'wallet-btn',
            text: '+ Create New Repo',
            onclick: showNewRepoForm,
          }),
        ],
      }),
      pickerContainer,
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', {
            cls: 'wallet-btn',
            text: 'Cancel',
            onclick: () => overlay.remove(),
          }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create Project',
            attrs: { id: 'create-project-submit' },
            onclick: () => handleCreateProject(overlay, repoItems),
          }),
        ],
      }),
      el('div', { cls: 'modal-status', attrs: { id: 'project-modal-status' } }),
    ],
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  (document.getElementById('project-name') as HTMLInputElement)?.focus();
}

async function handleCreateProject(
  overlay: HTMLElement,
  repoItems: ProjectRepoItem[],
): Promise<void> {
  const nameInput = document.getElementById('project-name') as HTMLInputElement;
  const descInput = document.getElementById('project-desc') as HTMLInputElement;
  const status = document.getElementById('project-modal-status');
  const submitBtn = document.getElementById('create-project-submit') as HTMLButtonElement;

  const projectName = nameInput?.value.trim();
  if (!projectName) {
    if (status) status.textContent = 'Project name is required.';
    return;
  }

  if (repoItems.length === 0) {
    if (status) status.textContent = 'Add at least one repository.';
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;

    const groupIds: string[] = [];

    // Collect existing repo IDs
    for (const item of repoItems) {
      if (item.kind === 'existing') {
        groupIds.push(item.groupId);
      }
    }

    // Create new repos
    const newItems = repoItems.filter(
      (r): r is Extract<ProjectRepoItem, { kind: 'new' }> => r.kind === 'new',
    );
    for (let i = 0; i < newItems.length; i++) {
      const r = newItems[i];
      if (status) {
        status.textContent = `Creating repo ${i + 1}/${newItems.length}: ${r.name}...`;
        status.className = 'modal-status';
      }
      const { groupId } = await createRepo(r.name.trim(), r.description.trim());
      groupIds.push(groupId);
    }

    if (status) status.textContent = 'Linking repos to project...';
    const visSelect = document.getElementById('project-visibility') as HTMLSelectElement;
    const visibility = (visSelect?.value as 'public' | 'private') || 'public';
    await createProjectApi(projectName, descInput?.value.trim() ?? '', groupIds, visibility);

    if (status) {
      status.textContent = `\u2713 Project created with ${groupIds.length} repo${groupIds.length !== 1 ? 's' : ''}!`;
      status.className = 'modal-status success';
    }

    const slug = slugify(projectName);
    setTimeout(() => {
      overlay.remove();
      navigate(`/projects/${slug}`);
    }, 1200);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleImportRepo(overlay: HTMLElement): Promise<void> {
  const urlInput = document.getElementById('import-url') as HTMLInputElement;
  const status = document.getElementById('modal-status');
  const submitBtn = document.getElementById('import-submit') as HTMLButtonElement;

  const url = urlInput?.value.trim();
  if (!url) {
    if (status) status.textContent = 'URL is required.';
    return;
  }

  const source = parseRepoUrl(url);
  if (!source) {
    if (status) status.textContent = 'Unrecognized GitHub/GitLab URL.';
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.textContent = 'Starting import...';
      status.className = 'modal-status';
    }

    const { groupId } = await importFromGitHub(source, (msg, done) => {
      if (status) {
        status.textContent = msg;
        status.className = done ? 'modal-status success' : 'modal-status';
      }
    });

    setTimeout(() => {
      overlay.remove();
      navigate(buildPath(groupId));
    }, 1200);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}
