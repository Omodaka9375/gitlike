// ---------------------------------------------------------------------------
// GitLike � Repo View (Tree, Blob, Commits, Modals)
// ---------------------------------------------------------------------------

import {
  el,
  render,
  spinner,
  errorBox,
  shortCid,
  timeAgo,
  shortAddr,
  friendlyError,
} from './dom.js';
import { buildPath, buildCommitsPath, navigate, refreshRoute } from './router.js';
import type { Route } from './router.js';
import {
  fetchManifest,
  fetchJSON,
  fetchText,
  fetchBytes,
  resolveRef,
  walkCommitHistory,
  stageFiles,
  commitFiles,
  createBranch,
  mergeBranches,
  updateSettings,
  deleteRepo,
  createTag,
  forkRepo,
  uploadFile,
  hasSession,
  starRepo,
  unstarRepo,
  getRepoStars,
  togglePages,
  createDelegation,
  revokeDelegation,
  fetchRepoProjects,
  slugify,
} from '../api.js';
import type { CommitEntry } from '../api.js';
import { connectedAddress } from '../wallet.js';
import {
  fetchAndVerifyCommitSignature,
  signAndRegisterCommit,
  signDelegation,
} from '../signing.js';
import { renderMarkdown } from './markdown.js';
import type { Tree, Commit, Manifest, Address } from '../types.js';
import { gatewayUrl } from '../config.js';
import { zipSync } from 'fflate';
import { fillUserIdentity } from './user-identity.js';
import { shouldIgnore, parseGitignore } from '../file-filter.js';
import { showAlert, showPrompt, showConfirm } from './dialogs.js';
import { renderBackToRepos, canWrite } from './shared.js';

// ---------------------------------------------------------------------------
// Repo � shows header + file tree at root
// ---------------------------------------------------------------------------

export async function renderRepo(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading repository...'));

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found or has no manifest.'));
      return;
    }

    const commitCid = manifest.branches[route.branch];
    if (!commitCid) {
      render(root, errorBox(`Branch "${route.branch}" not found.`));
      return;
    }

    const commit = await fetchJSON<Commit>(commitCid);
    let tree = await fetchJSON<Tree>(commit.tree);

    // Decrypt tree entry names if encryption is enabled
    const repoKey = await getRepoKeyForManifest(manifest, route.groupId);
    if (repoKey && manifest.encryption?.encryptTreeNames) {
      tree = await decryptTreeNames(tree, repoKey);
    }

    // Detect license from tree for repos without manifest.license
    if (!manifest.license) {
      const licFile = tree.entries.find(
        (e) => e.kind === 'blob' && /^licen[cs]e(\.(md|txt))?$/i.test(e.name),
      );
      if (licFile) {
        try {
          const licText = await fetchText(licFile.cid);
          manifest.license = detectLicense(licText) ?? 'custom';
        } catch {
          /* best-effort */
        }
      }
    }

    const children: (HTMLElement | string)[] = [
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      renderActionBar(route, manifest),
      renderBreadcrumb(route),
      renderTreeTable(tree, route),
      renderLastCommit(commit),
    ];

    // README rendering
    const readme = tree.entries.find((e) => e.kind === 'blob' && /^readme\.md$/i.test(e.name));
    if (readme) {
      try {
        const md = await fetchText(readme.cid);
        const imgResolver = buildImageResolver(tree);
        children.push(
          el('div', { cls: 'readme-container', html: renderMarkdown(md, imgResolver) }),
        );
      } catch {
        // Skip if README fetch fails
      }
    }

    // Contributor stats (async, appended after render)
    const statsContainer = el('div', { cls: 'contributors' });
    children.push(statsContainer);

    render(root, ...children);

    // Wire up file search
    wireFileSearch(tree, route);

    // Load contributor stats in background
    loadContributorStats(statsContainer, manifest, route);
  } catch (err) {
    render(root, errorBox(`Error loading repo: ${err}`));
  }
}

/** Load contributor stats by walking commit history. */
async function loadContributorStats(
  container: HTMLElement,
  manifest: Manifest,
  route: Route,
): Promise<void> {
  try {
    const headCid = manifest.branches[route.branch];
    if (!headCid) return;
    const entries = await walkCommitHistory(headCid, 100);
    if (entries.length === 0) return;

    // Tally by address (stable key) so name changes are reflected
    const tally = new Map<string, number>();
    for (const { commit } of entries) {
      const addr = commit.author.toLowerCase();
      tally.set(addr, (tally.get(addr) || 0) + 1);
    }

    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = sorted[0]?.[1] ?? 1;

    container.appendChild(el('h2', { cls: 'section-title', text: 'Contributors' }));

    for (const [addr, count] of sorted) {
      const nameSpan = el('span');
      fillUserIdentity(nameSpan, addr, { size: 14 });

      const row = el('div', {
        cls: 'contributor-row',
        children: [
          nameSpan,
          el('div', {
            cls: 'contributor-bar',
            children: [
              el('div', {
                cls: 'contributor-bar-fill',
                attrs: { style: `width:${(count / max) * 100}%` },
              }),
            ],
          }),
          el('span', {
            cls: 'contributor-count',
            text: `${count} commit${count !== 1 ? 's' : ''}`,
          }),
        ],
      });
      container.appendChild(row);
    }
  } catch {
    // Contributor stats are best-effort
  }
}

/**
 * Build an image resolver that maps relative paths to IPFS gateway URLs.
 * Handles paths like "demo.gif", "./assets/img.png", etc.
 */
function buildImageResolver(tree: Tree): (src: string) => string | null {
  return (src: string) => {
    // Only resolve relative paths — leave absolute/external URLs alone
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return null;
    const clean = src.replace(/^\.[\/\\]/, '');
    // Check top-level tree entries for the file
    const entry = tree.entries.find((e) => e.kind === 'blob' && e.name === clean);
    if (entry) return gatewayUrl(entry.cid);
    return null;
  };
}

/** Known license display names keyed by ID. */
const LICENSE_LABELS: Record<string, string> = {
  NOL: 'NOL v1.0',
  MIT: 'MIT',
  'Apache-2.0': 'Apache 2.0',
  'GPL-3.0': 'GPL 3.0',
  'BSD-2-Clause': 'BSD 2-Clause',
};

/** Detect license ID from the raw LICENSE file text. */
function detectLicense(text: string): string | null {
  const head = text.slice(0, 200).toLowerCase();
  if (head.includes('nuclear option license')) return 'NOL';
  if (head.includes('mit license')) return 'MIT';
  if (head.includes('apache license')) return 'Apache-2.0';
  if (head.includes('gnu general public license')) return 'GPL-3.0';
  if (head.includes('bsd 2-clause')) return 'BSD-2-Clause';
  return null;
}

/** Collect all file paths from a tree recursively (client-side). */
async function collectPaths(tree: Tree, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const e of tree.entries) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.kind === 'blob') {
      paths.push(p);
    } else {
      try {
        const sub = await fetchJSON<Tree>(e.cid);
        paths.push(...(await collectPaths(sub, p)));
      } catch {
        /* skip */
      }
    }
  }
  return paths;
}

/** Attach a search handler to the file-search input. */
function wireFileSearch(tree: Tree, route: Route): void {
  const input = document.getElementById('file-search') as HTMLInputElement | null;
  if (!input) return;

  let allPaths: string[] | null = null;
  let dropdown: HTMLElement | null = null;

  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      dropdown?.remove();
      dropdown = null;
      return;
    }

    if (!allPaths) allPaths = await collectPaths(tree);
    const matches = allPaths.filter((p) => p.toLowerCase().includes(q)).slice(0, 15);

    dropdown?.remove();
    if (matches.length === 0) {
      dropdown = null;
      return;
    }

    dropdown = el('div', {
      cls: 'search-dropdown',
      children: matches.map((p) =>
        el('a', {
          cls: 'search-result',
          text: p,
          attrs: { href: buildPath(route.slug, route.branch, p) },
          onclick: () => {
            dropdown?.remove();
            dropdown = null;
          },
        }),
      ),
    });
    input.parentElement?.appendChild(dropdown);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown?.remove();
      dropdown = null;
    }, 200);
  });
}

// ---------------------------------------------------------------------------
// Tree / Blob � navigating into subdirectories or viewing files
// ---------------------------------------------------------------------------

export async function renderTreeOrBlob(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading...'));

  try {
    const commitCid = await resolveRef(route.groupId, route.branch);
    if (!commitCid) {
      render(root, errorBox('Could not resolve branch.'));
      return;
    }
    const commit = await fetchJSON<Commit>(commitCid);
    const manifest = await fetchManifest(route.groupId);

    // Decrypt tree names if needed
    const repoKey = manifest ? await getRepoKeyForManifest(manifest, route.groupId) : null;

    // Walk tree to find the target path
    let currentTree = await fetchJSON<Tree>(commit.tree);
    if (repoKey && manifest?.encryption?.encryptTreeNames) {
      currentTree = await decryptTreeNames(currentTree, repoKey);
    }
    const segments = route.segments;

    for (let i = 0; i < segments.length; i++) {
      const name = segments[i];
      const entry = currentTree.entries.find((e) => e.name === name);
      if (!entry) {
        render(root, errorBox(`Path not found: ${segments.slice(0, i + 1).join('/')}`));
        return;
      }

      if (entry.kind === 'tree') {
        currentTree = await fetchJSON<Tree>(entry.cid);
        if (repoKey && manifest?.encryption?.encryptTreeNames) {
          currentTree = await decryptTreeNames(currentTree, repoKey);
        }
        // If this is the last segment, render as tree
        if (i === segments.length - 1) {
          const elements: (HTMLElement | string)[] = [
            renderBackToRepos(),
            manifest ? renderRepoHeader(manifest, route) : el('div'),
            renderBreadcrumb(route),
            renderTreeTable(currentTree, route),
          ];
          if (canWrite(manifest)) {
            elements.push(
              el('button', {
                cls: 'action-btn delete-btn',
                text: '\ud83d\uddd1 Delete Folder',
                attrs: { style: 'margin-top:0.75rem' },
                onclick: () => handleDeleteFolder(route, currentTree),
              }),
            );
          }
          render(root, ...elements);
          return;
        }
      } else {
        // It's a blob — detect binary vs text
        let raw = await fetchBytes(entry.cid);
        if (repoKey) raw = await decryptBlobContent(repoKey, raw);
        if (isBinary(raw)) {
          render(
            root,
            renderBackToRepos(),
            manifest ? renderRepoHeader(manifest, route) : el('div'),
            renderBreadcrumb(route),
            renderBinaryPlaceholder(name, entry.cid, raw.byteLength),
          );
        } else {
          const content = new TextDecoder().decode(raw);
          const isMarkdown = /\.md$/i.test(name);
          render(
            root,
            renderBackToRepos(),
            manifest ? renderRepoHeader(manifest, route) : el('div'),
            renderBreadcrumb(route),
            isMarkdown
              ? renderMarkdownBlob(name, content, entry.cid, route, manifest, currentTree)
              : renderFileViewer(name, content, entry.cid, route, manifest),
          );
        }
        return;
      }
    }

    // Shouldn't reach here, but just in case
    render(root, errorBox('Unexpected navigation state.'));
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

// ---------------------------------------------------------------------------
// Commits � commit log view
// ---------------------------------------------------------------------------

export async function renderCommits(root: HTMLElement, route: Route): Promise<void> {
  render(root, spinner('Loading commit history...'));

  try {
    const manifest = await fetchManifest(route.groupId);
    if (!manifest) {
      render(root, errorBox('Repository not found.'));
      return;
    }

    const commitCid = manifest.branches[route.branch];
    if (!commitCid) {
      render(root, errorBox(`Branch "${route.branch}" not found.`));
      return;
    }

    const entries = await walkCommitHistory(commitCid);

    render(
      root,
      renderBackToRepos(),
      renderRepoHeader(manifest, route),
      el('h2', { cls: 'section-title', text: `Commits on ${route.branch}` }),
      renderCommitList(entries, route.slug, route.groupId),
    );
  } catch (err) {
    render(root, errorBox(`Error: ${err}`));
  }
}

// ---------------------------------------------------------------------------
// Action Bar � write operation buttons (shown when wallet connected)
// ---------------------------------------------------------------------------

function renderActionBar(route: Route, manifest?: Manifest): HTMLElement {
  const address = connectedAddress();
  const isAuth = !!address && hasSession();
  const writable = canWrite(manifest ?? null);

  const children: HTMLElement[] = [];

  // Download is always available
  children.push(
    el('button', {
      cls: 'action-btn',
      text: '\uD83D\uDCE5 Download',
      onclick: () => handleDownload(route),
    }),
  );

  // Fork is available when authenticated and viewing someone else's repo
  if (isAuth && !writable) {
    children.push(
      el('button', {
        cls: 'action-btn',
        text: '\uD83C\uDF74 Fork',
        onclick: () => handleFork(route),
      }),
    );
  }

  if (!writable) return el('div', { cls: 'action-bar', children });

  children.push(
    el('button', {
      cls: 'action-btn upload-btn',
      text: '\uD83D\uDCE4 Upload Files',
      onclick: () => showUploadModal(route),
    }),
    el('button', {
      cls: 'action-btn',
      text: '\uD83C\uDF3F New Branch',
      onclick: () => showBranchModal(route),
    }),
    el('button', {
      cls: 'action-btn',
      text: '\uD83D\uDD00 Merge',
      onclick: () => showMergeModal(route, manifest),
    }),
    el('button', {
      cls: 'action-btn',
      text: '\uD83C\uDFF7 Tag',
      onclick: () => showTagModal(route, manifest),
    }),
  );

  // Owner-only actions
  if (manifest && address) {
    const lower = address.toLowerCase();
    if (manifest.acl.owners.some((a) => a.toLowerCase() === lower)) {
      children.push(
        el('button', {
          cls: 'action-btn',
          text: '\uD83E\uDD16 Delegations',
          onclick: () => showDelegationModal(route, manifest),
        }),
        el('button', {
          cls: 'action-btn',
          text: '\u2699 Settings',
          onclick: () => showSettingsModal(route, manifest),
        }),
        el('button', {
          cls: 'action-btn delete-btn',
          text: '\ud83d\uddd1 Delete',
          onclick: async () => {
            if (!(await showConfirm(`Delete "${manifest.name}"? This cannot be undone.`))) return;
            try {
              await deleteRepo(route.groupId);
              navigate('/');
            } catch (err) {
              await showAlert(`Delete failed: ${friendlyError(err)}`);
            }
          },
        }),
      );
    }
  }

  return el('div', { cls: 'action-bar', children });
}

// ---------------------------------------------------------------------------
// Upload Files Modal
// ---------------------------------------------------------------------------

function showUploadModal(route: Route): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const fileInput = el('input', {
    attrs: { id: 'upload-files', type: 'file', multiple: 'true' },
  }) as HTMLInputElement;

  const folderInput = el('input', {
    attrs: { id: 'upload-folder', type: 'file', webkitdirectory: '', directory: '' },
  }) as HTMLInputElement;

  // Merge folder selection into the main file input list
  let folderFiles: File[] = [];
  folderInput.addEventListener('change', () => {
    folderFiles = folderInput.files ? Array.from(folderInput.files) : [];
    const hint = document.getElementById('upload-folder-hint');
    if (hint)
      hint.textContent = folderFiles.length > 0 ? `${folderFiles.length} file(s) from folder` : '';
  });

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Upload Files' }),
      el('label', { text: 'Select files', attrs: { for: 'upload-files' } }),
      fileInput,
      el('label', { text: 'Or select a folder', attrs: { for: 'upload-folder' } }),
      folderInput,
      el('p', { cls: 'field-hint', attrs: { id: 'upload-folder-hint' } }),
      el('label', { text: 'Commit message', attrs: { for: 'upload-msg' } }),
      el('input', {
        attrs: {
          id: 'upload-msg',
          type: 'text',
          placeholder: 'Add files',
          spellcheck: 'false',
        },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Upload & Commit',
            attrs: { id: 'upload-submit' },
            onclick: () => handleUpload(overlay, route),
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

async function handleUpload(overlay: HTMLElement, route: Route): Promise<void> {
  const fileInput = document.getElementById('upload-files') as HTMLInputElement;
  const msgInput = document.getElementById('upload-msg') as HTMLInputElement;
  const status = document.getElementById('modal-status');
  const submitBtn = document.getElementById('upload-submit') as HTMLButtonElement;

  const pickedFiles = fileInput?.files ? Array.from(fileInput.files) : [];
  // Retrieve folder files from the closure via the overlay's dataset
  const folderEl = document.getElementById('upload-folder') as HTMLInputElement;
  const folderFiles = folderEl?.files ? Array.from(folderEl.files) : [];
  const allFiles = [...pickedFiles, ...folderFiles];
  if (allFiles.length === 0) {
    if (status) status.textContent = 'Select at least one file or folder.';
    return;
  }

  const message = msgInput?.value.trim() || 'Add files';

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.textContent = `Uploading ${allFiles.length} file(s)...`;
      status.className = 'modal-status';
    }

    // Load .gitignore patterns from the repo's current tree (if any)
    let ignorePatterns: string[] = [];
    try {
      const manifest = await fetchManifest(route.groupId);
      const headCid = manifest?.branches[route.branch];
      if (headCid) {
        const commit = await fetchJSON<Commit>(headCid);
        const tree = await fetchJSON<Tree>(commit.tree);
        const gi = tree.entries.find((e) => e.kind === 'blob' && e.name === '.gitignore');
        if (gi) {
          const text = await fetchText(gi.cid);
          ignorePatterns = parseGitignore(text);
        }
      }
    } catch {
      /* best-effort */
    }

    // Also check uploaded files for a .gitignore (folder upload scenario)
    const raw = allFiles;
    if (ignorePatterns.length === 0) {
      const uploadedGi = raw.find((f) => {
        const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        return p === '.gitignore' || p.endsWith('/.gitignore');
      });
      if (uploadedGi) {
        try {
          ignorePatterns = parseGitignore(await uploadedGi.text());
        } catch {
          /* best-effort */
        }
      }
    }

    // Filter out ignored files (dot-directories, OS junk, .gitignore patterns)
    const pairs = raw
      .map((f) => ({
        file: f,
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      }))
      .filter(({ path }) => !shouldIgnore(path, ignorePatterns));

    const filtered = raw.length - pairs.length;
    if (pairs.length === 0) {
      if (status) status.textContent = 'All files were filtered (dot-directories / ignored).';
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const filterNote = filtered > 0 ? ` (${filtered} ignored)` : '';
    if (status) status.textContent = `Uploading ${pairs.length} file(s)${filterNote}...`;

    const fileArray = pairs.map((p) => p.file);
    const paths = pairs.map((p) => p.path);
    const staged = await stageFiles(route.groupId, fileArray, paths);

    if (status) status.textContent = 'Creating commit...';
    const { commitCid } = await commitFiles(route.groupId, route.branch, message, staged);

    // Signing is best-effort � don't block or fail if it doesn't work
    if (status) status.textContent = 'Signing commit...';
    try {
      await signAndRegisterCommit(route.groupId, commitCid);
    } catch {
      // Commit succeeded, signing failed � show warning instead of error
      if (status) {
        status.textContent = `\u2713 Committed ${staged.length} file(s)! (signature skipped)`;
        status.className = 'modal-status success';
        setTimeout(() => {
          overlay.remove();
          navigate(buildPath(route.slug, route.branch));
          refreshRoute();
        }, 1500);
        return;
      }
    }

    if (status) {
      status.textContent = `\u2713 Committed ${staged.length} file(s)!`;
      status.className = 'modal-status success';
    }

    setTimeout(() => {
      overlay.remove();
      // Refresh the current view
      navigate(buildPath(route.slug, route.branch));
      refreshRoute();
    }, 1000);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Create Branch Modal
// ---------------------------------------------------------------------------

function showBranchModal(route: Route): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Create Branch' }),
      el('p', { cls: 'modal-hint', text: `Branching from: ${route.branch}` }),
      el('label', { text: 'Branch name', attrs: { for: 'branch-name' } }),
      el('input', {
        attrs: {
          id: 'branch-name',
          type: 'text',
          placeholder: 'feature/my-branch',
          spellcheck: 'false',
          autofocus: 'true',
        },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create',
            attrs: { id: 'branch-submit' },
            onclick: () => handleCreateBranch(overlay, route),
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
  (document.getElementById('branch-name') as HTMLInputElement)?.focus();
}

async function handleCreateBranch(overlay: HTMLElement, route: Route): Promise<void> {
  const nameInput = document.getElementById('branch-name') as HTMLInputElement;
  const status = document.getElementById('modal-status');
  const submitBtn = document.getElementById('branch-submit') as HTMLButtonElement;

  const name = nameInput?.value.trim();
  if (!name) {
    if (status) status.textContent = 'Branch name is required.';
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.textContent = 'Creating branch...';
      status.className = 'modal-status';
    }

    await createBranch(route.groupId, name, route.branch);

    if (status) {
      status.textContent = `\u2713 Branch "${name}" created!`;
      status.className = 'modal-status success';
    }

    setTimeout(() => {
      overlay.remove();
      navigate(buildPath(route.slug, name));
    }, 1000);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Merge Branch Modal
// ---------------------------------------------------------------------------

function showMergeModal(route: Route, manifest?: Manifest): void {
  document.getElementById('action-modal')?.remove();

  const branches = manifest ? Object.keys(manifest.branches) : [route.branch];
  const defaultTarget = manifest?.defaultBranch ?? 'main';

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const sourceSelect = el('select', {
    attrs: { id: 'merge-source' },
    children: branches.map((b) =>
      el('option', {
        text: b,
        attrs: { value: b, ...(b === route.branch ? { selected: 'selected' } : {}) },
      }),
    ),
  }) as HTMLSelectElement;

  const targetSelect = el('select', {
    attrs: { id: 'merge-target' },
    children: branches.map((b) =>
      el('option', {
        text: b,
        attrs: { value: b, ...(b === defaultTarget ? { selected: 'selected' } : {}) },
      }),
    ),
  }) as HTMLSelectElement;

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Merge Branches' }),
      el('label', { text: 'Source branch', attrs: { for: 'merge-source' } }),
      sourceSelect,
      el('label', { text: 'Into target branch', attrs: { for: 'merge-target' } }),
      targetSelect,
      el('label', { text: 'Merge message', attrs: { for: 'merge-msg' } }),
      el('input', {
        attrs: {
          id: 'merge-msg',
          type: 'text',
          placeholder: `Merge ${route.branch} into ${defaultTarget}`,
          spellcheck: 'false',
        },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Merge',
            attrs: { id: 'merge-submit' },
            onclick: () => handleMerge(overlay, route),
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

async function handleMerge(overlay: HTMLElement, route: Route): Promise<void> {
  const sourceSelect = document.getElementById('merge-source') as HTMLSelectElement;
  const targetSelect = document.getElementById('merge-target') as HTMLSelectElement;
  const msgInput = document.getElementById('merge-msg') as HTMLInputElement;
  const status = document.getElementById('modal-status');
  const submitBtn = document.getElementById('merge-submit') as HTMLButtonElement;

  const source = sourceSelect?.value;
  const target = targetSelect?.value;

  if (!source || !target) {
    if (status) status.textContent = 'Select source and target branches.';
    return;
  }
  if (source === target) {
    if (status) status.textContent = 'Source and target must differ.';
    return;
  }

  const message = msgInput?.value.trim() || undefined;

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.textContent = `Merging ${source} into ${target}...`;
      status.className = 'modal-status';
    }

    const mergeResult = await mergeBranches(route.groupId, source, target, message);

    if (status) status.textContent = 'Signing merge commit...';
    await signAndRegisterCommit(route.groupId, mergeResult.commitCid);

    if (status) {
      status.textContent = `\u2713 Merged ${source} into ${target}!`;
      status.className = 'modal-status success';
    }

    setTimeout(() => {
      overlay.remove();
      navigate(buildPath(route.slug, target));
      refreshRoute();
    }, 1000);
  } catch (err) {
    if (status) {
      status.textContent = `Error: ${friendlyError(err)}`;
      status.className = 'modal-status error';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export function renderRepoHeader(manifest: Manifest, route: Route): HTMLElement {
  const branches = Object.keys(manifest.branches);
  const tags = manifest.tags ? Object.keys(manifest.tags) : [];

  const navChildren: HTMLElement[] = [
    el('select', {
      cls: 'branch-select',
      attrs: { id: 'branch-select' },
      children: branches.map((b) => {
        const isProtected = manifest.protectedBranches?.includes(b);
        return el('option', {
          text: isProtected ? `\uD83D\uDD12 ${b}` : b,
          attrs: { value: b, ...(b === route.branch ? { selected: 'selected' } : {}) },
        });
      }),
    }),
    el('a', {
      cls: 'nav-link',
      text: '\uD83D\uDCDC Commits',
      attrs: { href: buildCommitsPath(route.slug, route.branch) },
    }),
    el('a', {
      cls: 'nav-link',
      text: '\uD83D\uDCE1 Feed',
      attrs: { href: `/api/repos/${route.groupId}/feed`, target: '_blank' },
    }),
  ];

  if (tags.length > 0) {
    navChildren.push(
      el('span', {
        cls: 'nav-link',
        text: `\uD83C\uDFF7 ${tags.length} tag${tags.length !== 1 ? 's' : ''}`,
      }),
    );
  }

  if (manifest.forkedFrom) {
    navChildren.push(
      el('a', {
        cls: 'nav-link',
        text: '\uD83C\uDF74 forked',
        attrs: {
          href: buildPath(manifest.forkedFrom),
          title: `Forked from ${manifest.forkedFrom}`,
        },
      }),
    );
  }

  const prCount = (manifest.pullRequests ?? []).length;
  navChildren.push(
    el('a', {
      cls: 'nav-link',
      children: [
        el('span', { text: '\uD83D\uDD03 PRs' }),
        ...(prCount > 0 ? [el('span', { cls: 'badge', text: String(prCount) })] : []),
      ],
      attrs: { href: `/${route.groupId}/prs` },
    }),
  );

  // Search input
  const searchInput = el('input', {
    cls: 'branch-select',
    attrs: { id: 'file-search', type: 'text', placeholder: 'Search files...', spellcheck: 'false' },
  }) as HTMLInputElement;
  navChildren.push(searchInput);

  const titleChildren: HTMLElement[] = [
    el('a', {
      text: manifest.name,
      attrs: { href: buildPath(route.slug, route.branch) },
    }),
  ];
  if (manifest.visibility === 'private') {
    titleChildren.push(el('span', { cls: 'badge badge-private', text: '\uD83D\uDD12 Private' }));
  }

  const shareBtn = el('button', {
    cls: 'topbar-icon-btn share-btn',
    text: '\uD83D\uDD17',
    attrs: { title: 'Share this repo' },
    onclick: () => handleShareRepo(route.slug, manifest.name),
  });

  // Star button � count loaded async
  const starIcon = el('span', { cls: 'star-icon', text: '\u2606' });
  const starCount = el('span', { cls: 'star-count', text: '\u2014' });
  const starBtn = el('button', {
    cls: 'star-btn',
    attrs: { title: 'Star this repo' },
    children: [starIcon, starCount],
  });
  loadStarState(starBtn, starIcon, starCount, route.groupId);

  // Owner pill linking to profile
  const ownerAddr = manifest.acl.owners[0];
  const ownerPill = el('a', {
    cls: 'repo-owner-pill',
    attrs: { href: `/user/${ownerAddr}` },
  });
  fillUserIdentity(ownerPill, ownerAddr);

  // License pill
  const licensePill = manifest.license
    ? el('a', {
        cls: 'license-pill',
        text: `\u2696\uFE0F ${LICENSE_LABELS[manifest.license] ?? manifest.license}`,
        attrs: { href: buildPath(route.slug, route.branch, 'LICENSE'), title: manifest.license },
      })
    : null;

  const metaChildren: HTMLElement[] = [
    ownerPill,
    ...(licensePill ? [licensePill] : []),
    ...(manifest.pages?.enabled
      ? [
          el('a', {
            cls: 'pages-url',
            text: `\uD83C\uDF10 app.gitlike.dev/${manifest.pages.slug}`,
            attrs: {
              href: `https://app.gitlike.dev/${manifest.pages.slug}`,
              target: '_blank',
              rel: 'noopener',
            },
          }),
        ]
      : []),
    el('div', { cls: 'repo-header-projects', attrs: { 'data-group-id': route.groupId } }),
  ];

  const header = el('header', {
    cls: 'repo-header',
    children: [
      el('div', {
        cls: 'repo-title-row',
        children: [
          el('h1', { children: titleChildren }),
          starBtn,
          shareBtn,
          el('span', { cls: 'repo-desc', text: manifest.description }),
        ],
      }),
      el('div', { cls: 'repo-meta-row', children: metaChildren }),
      el('nav', { cls: 'repo-nav', children: navChildren }),
    ],
  });

  // Load project membership async (non-blocking)
  loadProjectBadges(route.groupId);

  return header;
}

/** Show "Part of <Project>" pills if the repo belongs to any projects. */
async function loadProjectBadges(groupId: string): Promise<void> {
  try {
    const projects = await fetchRepoProjects(groupId);
    if (projects.length === 0) return;
    const container = document.querySelector(`.repo-header-projects[data-group-id="${groupId}"]`);
    if (!container) return;
    for (const p of projects) {
      const pSlug = slugify(p.name);
      container.appendChild(
        el('a', {
          cls: 'repo-owner-pill',
          attrs: { href: `/projects/${pSlug}` },
          children: [el('span', { text: '\uD83D\uDCC1' }), el('span', { text: p.name })],
        }),
      );
    }
  } catch {
    /* best-effort */
  }
}

/** Load star count and wire up toggle behaviour. */
async function loadStarState(
  btn: HTMLElement,
  icon: HTMLElement,
  countEl: HTMLElement,
  groupId: string,
): Promise<void> {
  let isStarred = false;
  let count = 0;

  try {
    const data = await getRepoStars(groupId);
    isStarred = data.starred;
    count = data.count;
  } catch {
    // Best-effort
  }

  countEl.textContent = String(count);
  icon.textContent = isStarred ? '\u2605' : '\u2606';
  if (isStarred) btn.classList.add('starred');

  btn.addEventListener('click', async () => {
    if (!hasSession()) {
      await showAlert('Please connect your wallet to star repos.');
      return;
    }
    try {
      const data = isStarred ? await unstarRepo(groupId) : await starRepo(groupId);
      isStarred = data.starred;
      count = data.count;
      countEl.textContent = String(count);
      icon.textContent = isStarred ? '\u2605' : '\u2606';
      btn.classList.toggle('starred', isStarred);
    } catch (err) {
      await showAlert(`Failed to ${isStarred ? 'unstar' : 'star'}: ${friendlyError(err)}`);
    }
  });
}

/** Share a repo link using Web Share API or clipboard fallback. */
async function handleShareRepo(groupId: string, name: string): Promise<void> {
  const url = `${window.location.origin}/${groupId}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: `${name} \u2014 GitLike`, url });
      return;
    } catch {
      // User cancelled or share failed � fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    // Brief visual feedback on the share button
    const btn = document.querySelector('.share-btn');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '\u2713';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    }
  } catch {
    // Last resort � prompt
    await showPrompt('Copy this link:', url);
  }
}

function renderBreadcrumb(route: Route): HTMLElement {
  // Compute parent path for the back button
  const segments = route.segments;
  let parentHref: string;
  if (segments.length > 1) {
    parentHref = buildPath(route.slug, route.branch, segments.slice(0, -1).join('/'));
  } else {
    parentHref = buildPath(route.slug, route.branch);
  }

  const crumbs: HTMLElement[] = [];

  // Back arrow � always visible when inside a repo path
  if (segments.length > 0) {
    crumbs.push(
      el('a', {
        cls: 'breadcrumb-back',
        text: '\u2190',
        attrs: { href: parentHref, title: 'Go up one level' },
      }),
    );
  }

  crumbs.push(el('a', { text: 'root', attrs: { href: buildPath(route.slug, route.branch) } }));

  let accumulated = '';
  for (const seg of segments) {
    accumulated += (accumulated ? '/' : '') + seg;
    crumbs.push(el('span', { cls: 'breadcrumb-sep', text: '/' }));
    crumbs.push(
      el('a', {
        text: seg,
        attrs: { href: buildPath(route.slug, route.branch, accumulated) },
      }),
    );
  }

  return el('nav', { cls: 'breadcrumb', children: crumbs });
}

export function renderTreeTable(tree: Tree, route: Route): HTMLElement {
  const sorted = [...tree.entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'tree' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const rows = sorted.map((entry) => {
    const icon = entry.kind === 'tree' ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    const entryPath = route.path ? `${route.path}/${entry.name}` : entry.name;
    const href = buildPath(route.slug, route.branch, entryPath);

    const row = el('tr', {
      attrs: entry.kind === 'tree' ? { 'data-tree-cid': entry.cid } : {},
      children: [
        el('td', { cls: 'icon-cell', text: icon }),
        el('td', {
          children: [el('a', { text: entry.name, attrs: { href } })],
        }),
        el('td', {
          cls: 'cid-cell',
          children: [
            el('span', { text: shortCid(entry.cid), attrs: { title: entry.cid } }),
            copyButton(entry.cid),
          ],
        }),
        el('td', {
          cls: 'size-cell',
          text: entry.size != null ? formatBytes(entry.size) : '\u2014',
        }),
      ],
    });
    return row;
  });

  const table = el('table', {
    cls: 'file-tree',
    children: [
      el('thead', {
        children: [
          el('tr', {
            children: [
              el('th'),
              el('th', { text: 'Name' }),
              el('th', { text: 'CID' }),
              el('th', { text: 'Size' }),
            ],
          }),
        ],
      }),
      el('tbody', { children: rows }),
    ],
  });

  // Async-prune rows whose subtree is empty (legacy deleted folders)
  void (async () => {
    const treeRows = table.querySelectorAll<HTMLElement>('[data-tree-cid]');
    await Promise.all(
      Array.from(treeRows).map(async (row) => {
        const cid = row.getAttribute('data-tree-cid');
        if (!cid) return;
        try {
          const sub = await fetchJSON<Tree>(cid);
          if (sub.entries.length === 0) row.remove();
        } catch {
          // If the subtree can't be fetched, leave the row visible
        }
      }),
    );
  })();

  return table;
}

function renderFileViewer(
  name: string,
  content: string,
  cid: string,
  route?: Route,
  manifest?: Manifest | null,
): HTMLElement {
  const ext = name.split('.').pop() ?? '';
  const langClass = extToLanguage(ext);

  const headerChildren: HTMLElement[] = [
    el('span', { text: name }),
    el('span', { cls: 'file-cid', text: shortCid(cid), attrs: { title: cid } }),
  ];

  // History button (always visible)
  if (route) {
    headerChildren.push(
      el('a', {
        cls: 'action-btn',
        text: '\uD83D\uDCDC History',
        attrs: { href: `/${route.slug}/history/${route.branch}/${route.path}` },
      }),
    );
  }

  // Show edit/delete only for developers
  if (route && canWrite(manifest ?? null)) {
    headerChildren.push(
      el('button', {
        cls: 'action-btn',
        text: '\u270f Edit',
        onclick: () => handleEditFile(route, name, content),
      }),
      el('button', {
        cls: 'action-btn delete-btn',
        text: '\ud83d\uddd1 Delete',
        onclick: () => handleDeleteFile(route, name),
      }),
    );
  }

  // Copy CID button
  headerChildren.push(copyButton(cid));

  const lines = content.split('\n');
  const lineNums = lines.map((_, i) => String(i + 1)).join('\n');
  const codeEl = el('code', { cls: `line-content ${langClass}`, text: content });

  const container = el('div', {
    cls: 'file-viewer',
    children: [
      el('div', { cls: 'file-viewer-header', children: headerChildren }),
      el('pre', {
        children: [
          el('div', {
            cls: 'line-numbers',
            children: [el('div', { cls: 'line-nums', text: lineNums }), codeEl],
          }),
        ],
      }),
    ],
  });

  // Syntax highlight after DOM insertion
  requestAnimationFrame(() => {
    if (window.Prism && langClass !== 'language-plaintext') {
      window.Prism.highlightElement(codeEl);
    }
  });

  return container;
}

/** Render a markdown file with preview + toggle to raw source. */
function renderMarkdownBlob(
  name: string,
  content: string,
  cid: string,
  route: Route,
  manifest?: Manifest | null,
  tree?: Tree,
): HTMLElement {
  const headerChildren: HTMLElement[] = [
    el('span', { text: name }),
    el('span', { cls: 'file-cid', text: shortCid(cid), attrs: { title: cid } }),
    el('a', {
      cls: 'action-btn',
      text: '\uD83D\uDCDC History',
      attrs: { href: `/${route.slug}/history/${route.branch}/${route.path}` },
    }),
  ];

  const rawViewer = renderFileViewer(name, content, cid, route, manifest);
  rawViewer.style.display = 'none';

  const imgResolver = tree ? buildImageResolver(tree) : undefined;
  const mdContainer = el('div', {
    cls: 'readme-container',
    html: renderMarkdown(content, imgResolver),
  });

  const toggleBtn = el('button', {
    cls: 'action-btn',
    text: '</> Source',
    onclick: () => {
      const showingRaw = rawViewer.style.display !== 'none';
      rawViewer.style.display = showingRaw ? 'none' : '';
      mdContainer.style.display = showingRaw ? '' : 'none';
      toggleBtn.textContent = showingRaw ? '</> Source' : '\uD83D\uDCD6 Preview';
    },
  });
  headerChildren.push(toggleBtn);

  if (canWrite(manifest ?? null)) {
    headerChildren.push(
      el('button', {
        cls: 'action-btn',
        text: '\u270f Edit',
        onclick: () => handleEditFile(route, name, content),
      }),
      el('button', {
        cls: 'action-btn delete-btn',
        text: '\ud83d\uddd1 Delete',
        onclick: () => handleDeleteFile(route, name),
      }),
    );
  }

  headerChildren.push(copyButton(cid));

  return el('div', {
    cls: 'file-viewer',
    children: [
      el('div', { cls: 'file-viewer-header', children: headerChildren }),
      mdContainer,
      rawViewer,
    ],
  });
}

/** Delete all files in a folder by committing them with deleted flag. */
async function handleDeleteFolder(route: Route, tree: Tree): Promise<void> {
  const folderName = route.segments[route.segments.length - 1];
  const paths = await collectPaths(tree, route.path);
  if (paths.length === 0) {
    await showAlert('Folder is empty.');
    return;
  }

  const confirmed = await showConfirm(
    `Delete folder "${folderName}" and all ${paths.length} file(s) inside it?`,
  );
  if (!confirmed) return;

  const message = await showPrompt('Commit message:', `Delete ${folderName}/`);
  if (message === null) return;

  try {
    const deleted = paths.map((p) => ({ path: p, cid: '', size: 0, deleted: true as const }));
    const { commitCid } = await commitFiles(
      route.groupId,
      route.branch,
      message || `Delete ${folderName}/`,
      deleted,
    );
    await signAndRegisterCommit(route.groupId, commitCid);
    const parentPath = route.segments.slice(0, -1).join('/');
    navigate(buildPath(route.slug, route.branch, parentPath));
  } catch (err) {
    await showAlert(`Delete failed: ${friendlyError(err)}`);
  }
}

/** Delete a file by committing with deleted flag. */
async function handleDeleteFile(route: Route, fileName: string): Promise<void> {
  const message = await showPrompt(`Commit message for deletion:`, `Delete ${fileName}`);
  if (message === null) return;

  try {
    const { commitCid } = await commitFiles(
      route.groupId,
      route.branch,
      message || `Delete ${fileName}`,
      [{ path: route.path, cid: '', size: 0, deleted: true }],
    );
    await signAndRegisterCommit(route.groupId, commitCid);
    // Navigate back to parent directory
    const parentPath = route.segments.slice(0, -1).join('/');
    navigate(buildPath(route.slug, route.branch, parentPath));
  } catch (err) {
    await showAlert(`Delete failed: ${friendlyError(err)}`);
  }
}

function renderLastCommit(commit: Commit): HTMLElement {
  const authorEl = el('span', { cls: 'commit-author' });
  fillUserIdentity(authorEl, commit.author);
  return el('div', {
    cls: 'last-commit',
    children: [
      authorEl,
      el('span', { cls: 'commit-message', text: commit.message }),
      el('span', { cls: 'commit-time', text: timeAgo(commit.timestamp) }),
    ],
  });
}

export function renderCommitList(
  entries: CommitEntry[],
  slug: string,
  groupId?: string,
): HTMLElement {
  const items = entries.map(({ cid, commit: c }) => {
    const sigBadge = el('span', { cls: 'badge', text: '' });
    verifySigAsync(cid, c, sigBadge, groupId ?? slug);

    return el('a', {
      cls: 'commit-item',
      attrs: { href: `/${slug}/commit/${cid}` },
      children: [
        el('div', {
          cls: 'commit-item-header',
          children: [
            el('span', { cls: 'commit-message', text: c.message }),
            sigBadge,
            c.delegation
              ? el('span', { cls: 'badge agent-badge', text: '\uD83E\uDD16 agent' })
              : el('span'),
          ],
        }),
        el('div', {
          cls: 'commit-item-meta',
          children: [
            (() => {
              const s = el('span');
              fillUserIdentity(s, c.author);
              return s;
            })(),
            el('span', { text: ' committed ' }),
            el('span', { text: timeAgo(c.timestamp) }),
          ],
        }),
      ],
    });
  });

  return el('div', { cls: 'commit-list', children: items });
}

/** Verify signature and update badge in-place. */
async function verifySigAsync(
  cid: string,
  commit: Commit,
  badge: HTMLElement,
  repoId?: string,
): Promise<void> {
  try {
    const { verified } = await fetchAndVerifyCommitSignature(cid, commit, repoId);
    if (verified) {
      badge.textContent = '\u2705 signed';
      badge.className = 'badge verified-badge';
    }
  } catch {
    // Verification failed or no signature � leave badge empty
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Detect if content is binary (null bytes in first 8 KB). */
function isBinary(data: Uint8Array): boolean {
  // Check first 8KB for null bytes
  const check = Math.min(data.byteLength, 8192);
  for (let i = 0; i < check; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

/** Render a placeholder for binary files. */
function renderBinaryPlaceholder(name: string, cid: string, size: number): HTMLElement {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);

  const children: HTMLElement[] = [
    el('div', {
      cls: 'file-viewer-header',
      children: [
        el('span', { text: name }),
        el('span', { cls: 'file-cid', text: shortCid(cid), attrs: { title: cid } }),
      ],
    }),
  ];

  if (isImage) {
    children.push(
      el('div', {
        cls: 'binary-preview',
        children: [el('img', { attrs: { src: gatewayUrl(cid), alt: name }, cls: 'preview-image' })],
      }),
    );
  } else {
    children.push(
      el('div', {
        cls: 'binary-placeholder',
        children: [
          el('p', { text: `Binary file \u2014 ${formatBytes(size)}` }),
          el('p', { cls: 'empty-state', text: 'This file cannot be displayed as text.' }),
        ],
      }),
    );
  }

  return el('div', { cls: 'file-viewer', children });
}

/** Create a copy-to-clipboard button. */
function copyButton(text: string): HTMLElement {
  const btn = el('button', {
    cls: 'copy-btn',
    text: '\uD83D\uDCCB Copy',
    attrs: { title: 'Copy to clipboard' },
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '\u2713';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '\uD83D\uDCCB';
          btn.classList.remove('copied');
        }, 1500);
      } catch {
        /* clipboard unavailable */
      }
    },
  });
  return btn;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map file extension to a Prism.js language class. */
function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'language-typescript',
    tsx: 'language-typescript',
    js: 'language-javascript',
    jsx: 'language-javascript',
    json: 'language-json',
    md: 'language-markdown',
    html: 'language-html',
    css: 'language-css',
    py: 'language-python',
    rs: 'language-rust',
    go: 'language-go',
    sol: 'language-solidity',
    sh: 'language-bash',
    yml: 'language-yaml',
    yaml: 'language-yaml',
    toml: 'language-toml',
  };
  return map[ext] ?? 'language-plaintext';
}

// ---------------------------------------------------------------------------
// In-browser file editing
// ---------------------------------------------------------------------------

async function handleEditFile(route: Route, name: string, content: string): Promise<void> {
  const viewer = document.querySelector('.file-viewer');
  if (!viewer) return;

  const textarea = el('textarea', {
    cls: 'edit-textarea',
    attrs: { rows: '30', spellcheck: 'false' },
  }) as HTMLTextAreaElement;
  textarea.value = content;

  const saveBtn = el('button', {
    cls: 'wallet-btn create-repo-btn',
    text: 'Save & Commit',
    onclick: async () => {
      const msg = await showPrompt('Commit message:', `Edit ${name}`);
      if (msg === null) return;
      saveBtn.textContent = 'Saving...';
      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        const blob = new Blob([textarea.value], { type: 'text/plain' });
        const file = new File([blob], name);
        const { cid, size } = await uploadFile(route.groupId, file);
        const { commitCid } = await commitFiles(
          route.groupId,
          route.branch,
          msg || `Edit ${name}`,
          [{ path: route.path, cid, size }],
        );
        await signAndRegisterCommit(route.groupId, commitCid);
        refreshRoute();
      } catch (err) {
        await showAlert(`Save failed: ${friendlyError(err)}`);
        saveBtn.textContent = 'Save & Commit';
        (saveBtn as HTMLButtonElement).disabled = false;
      }
    },
  });

  const cancelBtn = el('button', {
    cls: 'wallet-btn',
    text: 'Cancel',
    onclick: () => refreshRoute(),
  });

  viewer.innerHTML = '';
  viewer.appendChild(
    el('div', { cls: 'file-viewer-header', children: [el('span', { text: `Editing: ${name}` })] }),
  );
  viewer.appendChild(textarea);
  viewer.appendChild(el('div', { cls: 'modal-actions', children: [cancelBtn, saveBtn] }));
}

// ---------------------------------------------------------------------------
// Tag Modal
// ---------------------------------------------------------------------------

function showTagModal(route: Route, manifest?: Manifest): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });
  const commitCid = manifest?.branches[route.branch] ?? '';

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Create Tag' }),
      el('p', {
        cls: 'modal-hint',
        text: `Tagging HEAD of ${route.branch} (${shortCid(commitCid)})`,
      }),
      el('label', { text: 'Tag name', attrs: { for: 'tag-name' } }),
      el('input', {
        attrs: { id: 'tag-name', type: 'text', placeholder: 'v1.0.0', spellcheck: 'false' },
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Create Tag',
            attrs: { id: 'tag-submit' },
            onclick: async () => {
              const nameInput = document.getElementById('tag-name') as HTMLInputElement;
              const name = nameInput?.value.trim();
              if (!name) return;
              const status = document.getElementById('modal-status');
              const btn = document.getElementById('tag-submit') as HTMLButtonElement;
              if (btn) btn.disabled = true;
              if (status) status.textContent = 'Creating tag...';
              try {
                await createTag(route.groupId, name, commitCid);
                if (status) {
                  status.textContent = `\u2713 Tag "${name}" created!`;
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
// Encryption helpers
// ---------------------------------------------------------------------------

/** Try to get the repo key for an encrypted repo. Returns null if unavailable. */
async function getRepoKeyForManifest(
  manifest: Manifest,
  repoId: string,
): Promise<CryptoKey | null> {
  if (!manifest.encryption?.enabled || !manifest.keyBundle) return null;
  const address = connectedAddress();
  if (!address) return null;

  try {
    const { unlockRepoKey, deriveUEKFromSignature } = await import('../encryption.js');
    const epoch = manifest.encryption.currentEpoch;
    // Use signature-based UEK derivation as fallback
    // In a full ECDH implementation, this would use the wallet's private key + owner pubkey
    return await unlockRepoKey(repoId, manifest.keyBundle, epoch, address, async (ep: number) => {
      // Derive UEK from a deterministic signature for this repo
      const { walletClient } = await import('../wallet.js');
      const sig = await walletClient().signMessage({
        account: address,
        message: `gitlike-encryption-key:${repoId}:${ep}`,
      });
      return deriveUEKFromSignature(sig, repoId, ep);
    });
  } catch {
    return null;
  }
}

/** Decrypt tree entry names if encryption with encryptTreeNames is enabled. */
async function decryptTreeNames(tree: Tree, repoKey: CryptoKey): Promise<Tree> {
  const { decryptString } = await import('../encryption.js');
  const entries = await Promise.all(
    tree.entries.map(async (entry) => {
      try {
        const decryptedName = await decryptString(repoKey, entry.name);
        return { ...entry, name: decryptedName };
      } catch {
        return entry; // Name wasn't encrypted or decryption failed
      }
    }),
  );
  return { ...tree, entries };
}

/** Decrypt raw blob content. */
async function decryptBlobContent(repoKey: CryptoKey, raw: Uint8Array): Promise<Uint8Array> {
  try {
    const { shouldStream, decryptBlob } = await import('../encryption.js');
    const isStreamed = shouldStream(raw.byteLength);
    const decrypted = await decryptBlob(repoKey, raw.buffer as ArrayBuffer, isStreamed);
    return new Uint8Array(decrypted);
  } catch {
    return raw; // Not encrypted or decryption failed
  }
}

/** Build the encryption settings column for the settings modal. */
function buildEncryptionSettingsCol(manifest: Manifest, route: Route): HTMLElement {
  const isEncrypted = !!manifest.encryption?.enabled;
  const epoch = manifest.encryption?.currentEpoch ?? 0;
  const keyHolders = manifest.keyBundle?.[epoch]?.wrappedKeys
    ? Object.keys(manifest.keyBundle[epoch].wrappedKeys).length
    : 0;

  const children: (HTMLElement | string)[] = [el('h3', { text: '\uD83D\uDD12 Encryption' })];

  if (isEncrypted) {
    children.push(
      el('p', {
        cls: 'modal-hint',
        text: `Encryption: Active (AES-256-GCM, epoch ${epoch}, ${keyHolders} key holder${keyHolders !== 1 ? 's' : ''})`,
      }),
      el('div', {
        cls: 'modal-row',
        children: [
          el('label', {
            cls: 'platform-toggle-label',
            children: [
              el('input', {
                attrs: {
                  id: 'settings-encrypt-names',
                  type: 'checkbox',
                  ...(manifest.encryption?.encryptTreeNames ? { checked: 'checked' } : {}),
                },
              }),
              el('span', { text: ' Encrypt file/folder names' }),
            ],
          }),
        ],
      }),
      el('button', {
        cls: 'wallet-btn',
        text: '\uD83D\uDD04 Rotate Keys',
        attrs: { id: 'btn-rotate-keys' },
        onclick: async () => {
          const btn = document.getElementById('btn-rotate-keys') as HTMLButtonElement;
          if (btn) btn.disabled = true;
          try {
            const { rotateRepoKey, deriveUEKFromSignature } = await import('../encryption.js');
            const address = connectedAddress();
            if (!address || !manifest.keyBundle) throw new Error('Not connected.');
            const ownerPubKey = manifest.keyBundle[epoch].ownerPublicKey;
            const remaining = manifest.acl.owners.concat(manifest.acl.writers) as Address[];

            const { walletClient: getWC } = await import('../wallet.js');
            const { updatedBundle, newEpoch } = await rotateRepoKey(
              manifest.keyBundle,
              ownerPubKey,
              remaining,
              async (_addr: Address, ep: number) => {
                const sig = await getWC().signMessage({
                  account: address,
                  message: `gitlike-encryption-key:${route.groupId}:${ep}`,
                });
                return deriveUEKFromSignature(sig, route.groupId, ep);
              },
            );

            await updateSettings(route.groupId, {
              encryption: { ...manifest.encryption!, currentEpoch: newEpoch },
              keyBundle: updatedBundle,
            });

            await showAlert(`Keys rotated to epoch ${newEpoch}.`);
            refreshRoute();
          } catch (err) {
            await showAlert(`Key rotation failed: ${friendlyError(err)}`);
            if (btn) btn.disabled = false;
          }
        },
      }),
    );
  } else {
    children.push(
      el('p', { cls: 'modal-hint', text: 'Encryption is not enabled for this repo.' }),
      el('button', {
        cls: 'wallet-btn',
        text: '\uD83D\uDD10 Enable Encryption',
        attrs: { id: 'btn-enable-encryption' },
        onclick: async () => {
          const btn = document.getElementById('btn-enable-encryption') as HTMLButtonElement;
          if (btn) btn.disabled = true;
          try {
            const address = connectedAddress();
            if (!address) throw new Error('Wallet not connected.');

            const { createKeyBundleEpoch, deriveUEKFromSignature } =
              await import('../encryption.js');
            const { fetchPubkey } = await import('../api.js');

            const ownerPubKey = (await fetchPubkey(address)) ?? 'unknown';
            const authorized = [address, ...manifest.acl.writers] as Address[];
            const unique = [...new Set(authorized.map((a) => a.toLowerCase()))] as Address[];

            const { walletClient: getWC } = await import('../wallet.js');
            const { epochData } = await createKeyBundleEpoch(
              0,
              ownerPubKey,
              unique,
              async (_addr: Address, ep: number) => {
                const sig = await getWC().signMessage({
                  account: address,
                  message: `gitlike-encryption-key:${route.groupId}:${ep}`,
                });
                return deriveUEKFromSignature(sig, route.groupId, ep);
              },
            );

            await updateSettings(route.groupId, {
              encryption: {
                enabled: true,
                algorithm: 'AES-256-GCM',
                currentEpoch: 0,
              },
              keyBundle: { 0: epochData },
            });

            await showAlert('Encryption enabled! New files will be encrypted before upload.');
            refreshRoute();
          } catch (err) {
            await showAlert(`Failed to enable encryption: ${friendlyError(err)}`);
            if (btn) btn.disabled = false;
          }
        },
      }),
      el('p', {
        cls: 'modal-hint',
        text: 'Enabling encryption is one-way. Existing unencrypted content will remain readable.',
      }),
    );
  }

  return el('div', { cls: 'settings-col', children });
}

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------

function showSettingsModal(route: Route, manifest: Manifest): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  const modal = el('div', {
    cls: 'modal modal-wide',
    children: [
      el('h2', { text: 'Repository Settings' }),
      el('div', {
        cls: 'settings-columns',
        children: [
          el('div', {
            cls: 'settings-col',
            children: [
              el('h3', { text: 'General' }),
              el('label', { text: 'Name', attrs: { for: 'settings-name' } }),
              el('input', {
                attrs: { id: 'settings-name', type: 'text', value: manifest.name },
              }),
              el('label', { text: 'Description', attrs: { for: 'settings-desc' } }),
              el('input', {
                attrs: { id: 'settings-desc', type: 'text', value: manifest.description },
              }),
              el('label', {
                text: 'Developers (comma-separated addresses)',
                attrs: { for: 'settings-writers' },
              }),
              el('input', {
                attrs: {
                  id: 'settings-writers',
                  type: 'text',
                  value: manifest.acl.writers.join(', '),
                },
              }),
              el('label', {
                text: 'Protected branches (comma-separated)',
                attrs: { for: 'settings-protected' },
              }),
              el('input', {
                attrs: {
                  id: 'settings-protected',
                  type: 'text',
                  value: (manifest.protectedBranches ?? []).join(', '),
                },
              }),
              el('label', { text: 'Visibility', attrs: { for: 'settings-visibility' } }),
              el('select', {
                attrs: { id: 'settings-visibility' },
                children: [
                  el('option', {
                    text: 'Public',
                    attrs: {
                      value: 'public',
                      ...(manifest.visibility !== 'private' ? { selected: 'selected' } : {}),
                    },
                  }),
                  el('option', {
                    text: 'Private',
                    attrs: {
                      value: 'private',
                      ...(manifest.visibility === 'private' ? { selected: 'selected' } : {}),
                    },
                  }),
                ],
              }),
            ],
          }),
          buildEncryptionSettingsCol(manifest, route),
          el('div', {
            cls: 'settings-col',
            children: [
              el('h3', { text: '\uD83C\uDF10 GitLike Pages' }),
              el('div', {
                cls: 'modal-row',
                children: [
                  el('label', {
                    cls: 'platform-toggle-label',
                    children: [
                      el('input', {
                        attrs: {
                          id: 'settings-pages-enabled',
                          type: 'checkbox',
                          ...(manifest.pages?.enabled ? { checked: 'checked' } : {}),
                        },
                      }),
                      el('span', { text: ' Enable Pages' }),
                    ],
                  }),
                ],
              }),
              el('label', { text: 'Slug (URL path)', attrs: { for: 'settings-pages-slug' } }),
              el('input', {
                attrs: {
                  id: 'settings-pages-slug',
                  type: 'text',
                  value:
                    manifest.pages?.slug ?? manifest.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                  placeholder: 'my-repo',
                },
              }),
              el('div', {
                cls: 'modal-row',
                children: [
                  el('label', {
                    cls: 'platform-toggle-label',
                    children: [
                      el('input', {
                        attrs: {
                          id: 'settings-pages-spa',
                          type: 'checkbox',
                          ...(manifest.pages?.spa ? { checked: 'checked' } : {}),
                        },
                      }),
                      el('span', { text: ' SPA mode (index.html for all routes)' }),
                    ],
                  }),
                ],
              }),
              el('label', {
                text: 'Branch to serve',
                attrs: { for: 'settings-pages-branch' },
              }),
              el('select', {
                attrs: { id: 'settings-pages-branch' },
                children: Object.keys(manifest.branches).map((b) =>
                  el('option', {
                    text: b,
                    attrs: {
                      value: b,
                      ...((manifest.pages?.branch ?? manifest.defaultBranch) === b
                        ? { selected: 'selected' }
                        : {}),
                    },
                  }),
                ),
              }),
              el('label', {
                text: 'Publish from folder',
                attrs: { for: 'settings-pages-folder' },
              }),
              el('input', {
                attrs: {
                  id: 'settings-pages-folder',
                  type: 'text',
                  value: manifest.pages?.folder ?? '/',
                  placeholder: '/ (root)',
                },
              }),
              el('p', {
                cls: 'modal-hint',
                text: 'Subfolder to serve (e.g. /docs, /public, /dist). Use / for repo root.',
              }),
              ...(manifest.pages?.enabled
                ? [
                    el('p', {
                      cls: 'modal-hint',
                      children: [
                        el('span', { text: 'Live at: ' }),
                        el('a', {
                          text: `app.gitlike.dev/${manifest.pages.slug}`,
                          attrs: {
                            href: `https://app.gitlike.dev/${manifest.pages.slug}`,
                            target: '_blank',
                          },
                        }),
                      ],
                    }),
                  ]
                : []),
            ],
          }),
        ],
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Save',
            attrs: { id: 'settings-submit' },
            onclick: async () => {
              const btn = document.getElementById('settings-submit') as HTMLButtonElement;
              const status = document.getElementById('modal-status');
              if (btn) btn.disabled = true;
              if (status) status.textContent = 'Saving...';
              try {
                const name = (
                  document.getElementById('settings-name') as HTMLInputElement
                )?.value.trim();
                const description = (
                  document.getElementById('settings-desc') as HTMLInputElement
                )?.value.trim();
                const writersStr = (document.getElementById('settings-writers') as HTMLInputElement)
                  ?.value;
                const writers = writersStr
                  ? writersStr
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : undefined;
                const protectedStr = (
                  document.getElementById('settings-protected') as HTMLInputElement
                )?.value;
                const protectedBranches = protectedStr
                  ? protectedStr
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : undefined;
                const visSelect = document.getElementById(
                  'settings-visibility',
                ) as HTMLSelectElement;
                const visibility = (visSelect?.value as 'public' | 'private') || undefined;
                await updateSettings(route.groupId, {
                  name: name || undefined,
                  description,
                  writers,
                  protectedBranches,
                  visibility,
                });

                // Pages toggle
                const pagesEnabled = (
                  document.getElementById('settings-pages-enabled') as HTMLInputElement
                )?.checked;
                const pagesSlug = (
                  document.getElementById('settings-pages-slug') as HTMLInputElement
                )?.value.trim();
                const pagesBranch = (
                  document.getElementById('settings-pages-branch') as HTMLSelectElement
                )?.value;
                const pagesSpa = (document.getElementById('settings-pages-spa') as HTMLInputElement)
                  ?.checked;
                const pagesFolder = (
                  document.getElementById('settings-pages-folder') as HTMLInputElement
                )?.value
                  .trim()
                  .replace(/^\/+|^\.[\/\\]/, '')
                  .replace(/\/+$/, '');
                const wasEnabled = !!manifest.pages?.enabled;
                const slugChanged = manifest.pages?.slug !== pagesSlug;
                const branchChanged = manifest.pages?.branch !== pagesBranch;
                const spaChanged = !!manifest.pages?.spa !== pagesSpa;
                const folderChanged = (manifest.pages?.folder ?? '') !== pagesFolder;
                if (
                  pagesEnabled !== wasEnabled ||
                  (pagesEnabled && (slugChanged || branchChanged || spaChanged || folderChanged))
                ) {
                  if (status)
                    status.textContent = pagesEnabled ? 'Enabling Pages...' : 'Disabling Pages...';
                  await togglePages(
                    route.groupId,
                    pagesEnabled,
                    pagesSlug || undefined,
                    pagesBranch || undefined,
                    pagesSpa,
                    pagesFolder || undefined,
                  );
                }

                if (status) {
                  status.textContent = '\u2713 Settings saved!';
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
      el('hr'),
      el('button', {
        cls: 'wallet-btn',
        text: '\ud83d\uddd1 Delete Repository',
        attrs: { style: 'color: var(--red); border-color: var(--red);' },
        onclick: async () => {
          if (!(await showConfirm(`Delete "${manifest.name}"? This cannot be undone.`))) return;
          try {
            await deleteRepo(route.groupId);
            overlay.remove();
            navigate('/');
          } catch (err) {
            await showAlert(`Delete failed: ${friendlyError(err)}`);
          }
        },
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
// Delegation Management Modal
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [
  { label: '1 hour', ms: 3_600_000 },
  { label: '24 hours', ms: 86_400_000 },
  { label: '7 days', ms: 604_800_000 },
  { label: '30 days', ms: 2_592_000_000 },
];

function showDelegationModal(route: Route, manifest: Manifest): void {
  document.getElementById('action-modal')?.remove();

  const overlay = el('div', { cls: 'modal-overlay', attrs: { id: 'action-modal' } });

  // Collect existing delegations
  const allDelegations: Array<{
    owner: string;
    agent: string;
    scope: { actions: string[]; paths: string[] };
    expires: string;
  }> = [];
  for (const [owner, entries] of Object.entries(manifest.acl.agents)) {
    for (const entry of entries) {
      allDelegations.push({
        owner,
        agent: entry.key,
        scope: entry.scope,
        expires: entry.expires,
      });
    }
  }

  const existingList = el('div', { cls: 'delegation-list' });
  if (allDelegations.length > 0) {
    for (const d of allDelegations) {
      const isExpired = new Date(d.expires) <= new Date();
      const row = el('div', {
        cls: `delegation-row${isExpired ? ' expired' : ''}`,
        children: [
          el('div', {
            children: [
              el('strong', { text: shortAddr(d.agent) }),
              el('span', { cls: 'modal-hint', text: ` ${d.scope.actions.join(', ')}` }),
              el('span', {
                cls: 'modal-hint',
                text: ` | paths: ${d.scope.paths.join(', ')} | ${
                  isExpired ? 'expired' : `expires ${timeAgo(d.expires)}`
                }`,
              }),
            ],
          }),
          el('button', {
            cls: 'wallet-btn',
            text: 'Revoke',
            attrs: {
              style:
                'color: var(--red); border-color: var(--red); padding: 4px 10px; font-size: 0.85rem;',
            },
            onclick: async (e: MouseEvent) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              btn.textContent = 'Revoking...';
              try {
                await revokeDelegation(route.groupId, d.agent);
                row.remove();
              } catch (err) {
                btn.textContent = `Error: ${friendlyError(err)}`;
                btn.disabled = false;
              }
            },
          }),
        ],
      });
      existingList.appendChild(row);
    }
  } else {
    existingList.appendChild(el('p', { cls: 'modal-hint', text: 'No active delegations.' }));
  }

  const modal = el('div', {
    cls: 'modal',
    children: [
      el('h2', { text: 'Agent Delegations' }),
      el('p', { cls: 'modal-hint', text: 'Grant scoped write access to AI agent wallets.' }),
      el('h3', { text: 'Active Delegations' }),
      existingList,
      el('hr'),
      el('h3', { text: 'Grant New Delegation' }),
      el('label', { text: 'Agent address', attrs: { for: 'deleg-agent' } }),
      el('input', {
        attrs: { id: 'deleg-agent', type: 'text', placeholder: '0x...', spellcheck: 'false' },
      }),
      el('label', { text: 'Actions' }),
      el('div', {
        cls: 'modal-row',
        children: [
          el('label', {
            cls: 'platform-toggle-label',
            children: [
              el('input', {
                attrs: { id: 'deleg-act-commit', type: 'checkbox', checked: 'checked' },
              }),
              el('span', { text: ' commit' }),
            ],
          }),
          el('label', {
            cls: 'platform-toggle-label',
            children: [
              el('input', {
                attrs: { id: 'deleg-act-branch', type: 'checkbox', checked: 'checked' },
              }),
              el('span', { text: ' branch' }),
            ],
          }),
          el('label', {
            cls: 'platform-toggle-label',
            children: [
              el('input', {
                attrs: { id: 'deleg-act-merge', type: 'checkbox', checked: 'checked' },
              }),
              el('span', { text: ' merge' }),
            ],
          }),
        ],
      }),
      el('label', {
        text: 'Path restrictions (comma-separated globs, * = all)',
        attrs: { for: 'deleg-paths' },
      }),
      el('input', {
        attrs: { id: 'deleg-paths', type: 'text', value: '*', spellcheck: 'false' },
      }),
      el('label', { text: 'Expiry', attrs: { for: 'deleg-expiry' } }),
      el('select', {
        attrs: { id: 'deleg-expiry' },
        children: EXPIRY_OPTIONS.map((opt, i) =>
          el('option', {
            text: opt.label,
            attrs: { value: String(opt.ms), ...(i === 1 ? { selected: 'selected' } : {}) },
          }),
        ),
      }),
      el('div', {
        cls: 'modal-actions',
        children: [
          el('button', { cls: 'wallet-btn', text: 'Cancel', onclick: () => overlay.remove() }),
          el('button', {
            cls: 'wallet-btn create-repo-btn',
            text: 'Sign & Grant',
            attrs: { id: 'deleg-submit' },
            onclick: () => handleGrantDelegation(overlay, route),
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

async function handleGrantDelegation(overlay: HTMLElement, route: Route): Promise<void> {
  const status = document.getElementById('modal-status');
  const btn = document.getElementById('deleg-submit') as HTMLButtonElement;
  const agentInput = document.getElementById('deleg-agent') as HTMLInputElement;
  const pathsInput = document.getElementById('deleg-paths') as HTMLInputElement;
  const expirySelect = document.getElementById('deleg-expiry') as HTMLSelectElement;

  const agent = agentInput?.value.trim();
  if (!agent || !agent.startsWith('0x') || agent.length !== 42) {
    if (status) status.textContent = 'Enter a valid Ethereum address (0x..., 42 chars).';
    return;
  }

  const actions: string[] = [];
  if ((document.getElementById('deleg-act-commit') as HTMLInputElement)?.checked)
    actions.push('commit');
  if ((document.getElementById('deleg-act-branch') as HTMLInputElement)?.checked)
    actions.push('branch');
  if ((document.getElementById('deleg-act-merge') as HTMLInputElement)?.checked)
    actions.push('merge');
  if (actions.length === 0) {
    if (status) status.textContent = 'Select at least one action.';
    return;
  }

  const paths = (pathsInput?.value || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const expiresInMs = parseInt(expirySelect?.value || '86400000', 10);
  const expires = new Date(Date.now() + expiresInMs).toISOString();

  try {
    if (btn) btn.disabled = true;
    if (status) {
      status.textContent = 'Requesting wallet signature...';
      status.className = 'modal-status';
    }

    const address = connectedAddress();
    if (!address) throw new Error('Wallet not connected.');

    const signature = await signDelegation({
      type: 'delegation',
      delegator: address,
      agent: agent as `0x${string}`,
      repo: route.groupId,
      scope: { actions: actions as ('commit' | 'branch' | 'merge')[], paths },
      expires,
    });

    if (status) status.textContent = 'Submitting delegation...';

    await createDelegation(route.groupId, agent, { actions, paths }, signature, expiresInMs);

    if (status) {
      status.textContent = '\u2713 Delegation granted!';
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
}

// ---------------------------------------------------------------------------
// Fork handler
// ---------------------------------------------------------------------------

async function handleFork(route: Route): Promise<void> {
  if (!(await showConfirm('Fork this repository?'))) return;
  try {
    const { groupId } = await forkRepo(route.groupId);
    navigate(buildPath(groupId));
  } catch (err) {
    await showAlert(`Fork failed: ${friendlyError(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Download handler � builds a real ZIP from tree
// ---------------------------------------------------------------------------

async function handleDownload(route: Route): Promise<void> {
  try {
    const commitCid = await resolveRef(route.groupId, route.branch);
    if (!commitCid) {
      await showAlert('Could not resolve branch.');
      return;
    }
    const commit = await fetchJSON<Commit>(commitCid);
    const tree = await fetchJSON<Tree>(commit.tree);

    const files: Record<string, Uint8Array> = {};
    await collectFilesForZip(tree, '', files);

    const zipped = zipSync(files, { level: 6 });
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.branch}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    await showAlert(`Download failed: ${friendlyError(err)}`);
  }
}

/** Recursively collect all files as binary for ZIP archiving. */
async function collectFilesForZip(
  tree: Tree,
  prefix: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const entry of tree.entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'blob') {
      try {
        files[path] = await fetchBytes(entry.cid);
      } catch {
        files[path] = new TextEncoder().encode(`[fetch failed: ${entry.cid}]`);
      }
    } else {
      const sub = await fetchJSON<Tree>(entry.cid);
      await collectFilesForZip(sub, path, files);
    }
  }
}
