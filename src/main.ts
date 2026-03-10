// ---------------------------------------------------------------------------
// GitLike — Entry Point
// ---------------------------------------------------------------------------

import './prism.js';
import { currentRoute, onRouteChange, navigate } from './ui/router.js';
import type { Route } from './ui/router.js';
import {
  renderHome,
  renderHowItWorks,
  renderForAgents,
  renderRunYourOwn,
  renderCliAuth,
  renderCli,
  renderAbout,
  renderRepo,
  renderTreeOrBlob,
  renderCommits,
  renderCommitDetail,
  renderUserProfile,
  renderStarredRepos,
  renderPRList,
  renderPRDetail,
  renderIssueList,
  renderIssueDetail,
  renderFileHistory,
  renderProjectList,
  renderProjectDetail,
} from './ui/views.js';
import { renderWalletBar } from './ui/wallet-bar.js';
import { reconnect, attachProviderListeners } from './wallet.js';
import { refreshBar } from './ui/wallet-bar.js';
import { resolveSlug } from './api.js';

/** Route the current view to the correct renderer. */
async function handleRoute(route: Route): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  // Show loading indicator while route resolves
  const existingContent = document.getElementById('content');
  if (existingContent) {
    // Keep existing DOM visible; overlay a route-loading indicator
    existingContent.classList.add('route-loading');
  } else {
    // First render — build skeleton
    root.innerHTML = '';
    root.appendChild(renderWalletBar());
    const placeholder = document.createElement('div');
    placeholder.id = 'content';
    placeholder.classList.add('route-loading');
    root.appendChild(placeholder);
  }

  // Build new content off-screen
  const content = document.createElement('div');
  content.id = 'content';

  try {
    // Resolve slug → groupId for repo views
    if (route.slug && !route.groupId) {
      route.groupId = await resolveSlug(route.slug);
    }

    // Home renders full-bleed; other views use page-container
    const isFullBleed = route.view === 'home';
    if (!isFullBleed) content.classList.add('page-container');

    switch (route.view) {
      case 'home':
        renderHome(content);
        break;
      case 'how':
        renderHowItWorks(content);
        break;
      case 'agents':
        renderForAgents(content);
        break;
      case 'run-your-own':
        renderRunYourOwn(content);
        break;
      case 'cli-auth':
        await renderCliAuth(content);
        break;
      case 'cli':
        renderCli(content);
        break;
      case 'about':
        renderAbout(content);
        break;
      case 'repo':
        await renderRepo(content, route);
        break;
      case 'tree':
      case 'blob':
        await renderTreeOrBlob(content, route);
        break;
      case 'commits':
        await renderCommits(content, route);
        break;
      case 'commit':
        await renderCommitDetail(content, route);
        break;
      case 'user':
        await renderUserProfile(content, route);
        break;
      case 'stars':
        await renderStarredRepos(content, route);
        break;
      case 'prs':
        await renderPRList(content, route);
        break;
      case 'pr':
        await renderPRDetail(content, route);
        break;
      case 'issues':
        await renderIssueList(content, route);
        break;
      case 'issue':
        await renderIssueDetail(content, route);
        break;
      case 'history':
        await renderFileHistory(content, route);
        break;
      case 'projects':
        await renderProjectList(content);
        break;
      case 'project':
        await renderProjectDetail(content, route);
        break;
    }
  } catch (err) {
    renderErrorWithRetry(content, err, route);
  }

  // Swap in the new content
  const oldContent = document.getElementById('content');
  if (oldContent) {
    oldContent.replaceWith(content);
  } else {
    root.appendChild(content);
  }

  // Ensure wallet bar is present
  if (!root.querySelector('.wallet-bar')) {
    root.insertBefore(renderWalletBar(), root.firstChild);
  }

  // Wire up branch-select change events after render
  const branchSelect = document.getElementById('branch-select') as HTMLSelectElement | null;
  if (branchSelect) {
    branchSelect.addEventListener('change', () => {
      const newBranch = branchSelect.value;
      navigate(`/${route.slug || route.groupId}/${newBranch}`);
    });
  }

  // Footer
  root.appendChild(renderFooter());
}

/** Render the site footer. */
function renderFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML =
    '<div class="footer-inner">' +
    '<div class="footer-brand">' +
    '<span class="footer-brand-name">GitLike</span>' +
    '<p>Decentralized version control built on IPFS with SIWE authentication. Your code, your keys.</p>' +
    '</div>' +
    '<div class="footer-col">' +
    '<h4>Resources</h4>' +
    '<a href="/humans">For Humans</a>' +
    '<a href="/agents">For Agents</a>' +
    '<a href="/run-your-own">Run Your Own</a>' +
    '<a href="/about">About</a>' +
    '<a href="https://stats.uptimerobot.com/UsN4sHhQ0v" target="_blank" rel="noopener">Status</a>' +
    '</div>' +
    '<div class="footer-col">' +
    '<h4>Built With</h4>' +
    '<a href="https://filebase.com" target="_blank" rel="noopener">Filebase</a>' +
    '<a href="https://pinata.cloud" target="_blank" rel="noopener">Pinata</a>' +
    '<a href="https://cloudflare.com" target="_blank" rel="noopener">Cloudflare</a>' +
    '</div>' +
    '</div>' +
    '<div class="footer-bottom">\u00a9 2026 GitLike \u2014 Decentralized VCS on IPFS</div>';
  return footer;
}

/** Render an error with a retry button. */
function renderErrorWithRetry(container: HTMLElement, err: unknown, route: Route): void {
  const msg = err instanceof Error ? err.message : String(err);
  container.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = `Something went wrong: ${msg}`;

  const retryBtn = document.createElement('button');
  retryBtn.className = 'wallet-btn';
  retryBtn.textContent = 'Retry';
  retryBtn.style.marginTop = '0.75rem';
  retryBtn.addEventListener('click', () => handleRoute(route));

  box.appendChild(document.createElement('br'));
  box.appendChild(retryBtn);
  container.appendChild(box);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

let pendingG = false;

function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs/textareas
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      document.getElementById('action-modal')?.remove();
      document.getElementById('create-repo-modal')?.remove();
      document.getElementById('create-project-modal')?.remove();
      return;
    }

    // 't' or '/' focuses file search
    if (e.key === 't' || e.key === '/') {
      const search = document.getElementById('file-search') as HTMLInputElement | null;
      if (search) {
        e.preventDefault();
        search.focus();
      }
      pendingG = false;
      return;
    }

    // Two-key combos: g h = home, g c = commits
    if (e.key === 'g') {
      pendingG = true;
      setTimeout(() => {
        pendingG = false;
      }, 500);
      return;
    }

    if (pendingG) {
      pendingG = false;
      const route = currentRoute();
      if (e.key === 'h') {
        navigate('/');
        return;
      }
      if (e.key === 'c' && (route.slug || route.groupId)) {
        navigate(`/${route.slug || route.groupId}/commits/${route.branch || 'main'}`);
        return;
      }
    }
  });
}

/** Bootstrap: read config, set up router, render initial view. */
async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app element');

  // Restore theme preference (dark is the default)
  const savedTheme = localStorage.getItem('gitlike_theme');
  document.documentElement.dataset.theme = savedTheme || 'dark';

  // Register Service Worker for IPFS caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Restore wallet session before first render
  await reconnect();
  attachProviderListeners();

  // Refresh only the wallet bar when wallet state changes (not the whole page)
  window.addEventListener('wallet-changed', () => refreshBar());

  setupKeyboardShortcuts();
  handleRoute(currentRoute());
  onRouteChange(handleRoute);
}

/** Show a dismissable error banner for a few seconds. */
function showErrorBanner(msg: string): void {
  const banner = document.getElementById('error-banner');
  if (!banner) return;
  banner.textContent = `Error: ${msg}`;
  banner.style.display = 'block';
  setTimeout(() => {
    banner.style.display = 'none';
  }, 6000);
}

/** Report a client error to the backend (best-effort, fire-and-forget). */
function reportError(msg: string, source?: string): void {
  try {
    navigator.sendBeacon(
      '/api/errors',
      JSON.stringify({ message: msg, source, url: location.href, ts: Date.now() }),
    );
  } catch {
    // Best-effort
  }
}

// Global error handlers
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
  console.error('Unhandled rejection:', event.reason);
  showErrorBanner(msg);
  reportError(msg, 'unhandledrejection');
});

window.addEventListener('error', (event) => {
  const msg = event.error instanceof Error ? event.error.message : String(event.message);
  console.error('Uncaught error:', event.error);
  showErrorBanner(msg);
  reportError(msg, 'error');
});

document.addEventListener('DOMContentLoaded', bootstrap);
