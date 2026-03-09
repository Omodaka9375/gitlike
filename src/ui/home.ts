// ---------------------------------------------------------------------------
// GitLike Home View
// ---------------------------------------------------------------------------

import { el, render, spinner, errorBox, shortCid, timeAgo } from './dom.js';
import { buildPath } from './router.js';
import {
  fetchJSON,
  fetchText,
  listRepos,
  walkCommitHistory,
  getRepoStars,
  hasSession,
  slugify,
  fetchFederatedPeers,
  getStarredRepos,
  fetchManifest,
  fetchAlias,
  fetchPlatformSettings,
} from '../api.js';
import type { RepoSummary } from '../api.js';
import { connectedAddress } from '../wallet.js';
import { fillUserIdentity } from './user-identity.js';
import type { Tree, Commit, Manifest } from '../types.js';
import { getFollowing, syncFollowingFromServer } from './shared.js';

// ---------------------------------------------------------------------------
// Configuration — status endpoints shown in the marquee
// ---------------------------------------------------------------------------

const STATUS_ENDPOINTS = [
  { name: 'IPFS & CF Service', url: 'https://stats.uptimerobot.com/UsN4sHhQ0v/802496308' },
  { name: 'Pages API', url: 'https://stats.uptimerobot.com/UsN4sHhQ0v/802496298' },
];

// ---------------------------------------------------------------------------
// Home landing page
// ---------------------------------------------------------------------------

export function renderHome(root: HTMLElement): void {
  // Sync localStorage following list from server if authenticated
  const selfAddr = connectedAddress();
  if (selfAddr && hasSession()) syncFollowingFromServer(selfAddr);

  // Stats placeholder — filled async after repo list loads
  const heroStats = el('span', { cls: 'hero-stat', attrs: { id: 'hero-stats' } });
  const heroCtaChildren: HTMLElement[] = [heroStats];

  // Full-bleed hero wrapper
  const heroWrapper = el('div', {
    cls: 'hero-wrapper',
    children: [
      el('header', {
        cls: 'site-header',
        children: [
          el('img', {
            cls: 'hero-logo',
            attrs: { src: '/logo.png', alt: 'GitLike', draggable: 'false' },
          }),
          el('p', {
            cls: 'subtitle',
            text: 'Decentralized version control powered by IPFS & SIWE',
          }),
          el('div', {
            cls: 'hero-pills',
            children: [
              el('span', {
                cls: 'hero-pill',
                children: [
                  el('span', { cls: 'hero-pill-icon', text: '\uD83D\uDCCC' }),
                  el('span', { text: 'IPFS' }),
                ],
              }),
              el('span', {
                cls: 'hero-pill',
                children: [
                  el('span', { cls: 'hero-pill-icon', text: '\uD83D\uDD10' }),
                  el('span', { text: 'Sign-In-With-Ethereum' }),
                ],
              }),
              el('span', {
                cls: 'hero-pill',
                children: [
                  el('span', { cls: 'hero-pill-icon', text: '\uD83C\uDF3F' }),
                  el('span', { text: 'CLI' }),
                ],
              }),
              el('span', {
                cls: 'hero-pill',
                children: [
                  el('span', { cls: 'hero-pill-icon', text: '\uD83D\uDD00' }),
                  el('span', { text: 'Federation' }),
                ],
              }),
            ],
          }),
          el('div', { cls: 'hero-cta', children: heroCtaChildren }),
        ],
      }),
    ],
  });
  render(root, heroWrapper);

  // Discovery marquee — full-width ticker above the grid
  const marqueeContainer = el('div', { cls: 'marquee-wrapper' });
  root.appendChild(marqueeContainer);
  loadMarquee(marqueeContainer);

  // Two-column grid: activity | repos
  const grid = el('div', { cls: 'home-grid' });

  // Column 1: Activity
  const feedContainer = el('section', {
    cls: 'repo-list-section',
    children: [spinner('Loading activity...')],
  });
  grid.appendChild(feedContainer);
  loadActivityFeed(feedContainer);

  // Column 2: Repositories
  const repoListContainer = el('section', {
    cls: 'repo-list-section',
    children: [spinner('Loading repositories...')],
  });
  grid.appendChild(repoListContainer);
  loadRepoList(repoListContainer, heroStats);

  root.appendChild(grid);

  // "Following" section — show repos from followed creators below the grid
  const following = getFollowing();
  if (following.length > 0) {
    const followSection = el('section', {
      cls: 'repo-list-section',
      children: [spinner('Loading followed creators...')],
    });
    const followWrap = el('div', { cls: 'home-grid' });
    followWrap.appendChild(followSection);
    root.appendChild(followWrap);
    loadFollowingFeed(followSection, following);
  }
}

/** Load recent commits across all repos for the activity feed. */
async function loadActivityFeed(container: HTMLElement): Promise<void> {
  try {
    const { repos } = await listRepos(50);
    type FeedItem = { repoName: string; slug: string; cid: string; commit: Commit };
    const items: FeedItem[] = [];

    // Gather last commit from each repo's default branch
    const tasks = repos.slice(0, 20).map(async (repo) => {
      if (!repo.manifest) return;
      const branch = repo.manifest.defaultBranch;
      const headCid = repo.manifest.branches[branch];
      if (!headCid) return;
      try {
        const entries = await walkCommitHistory(headCid, 3);
        const repoSlug = slugify(repo.manifest!.name);
        for (const { cid, commit } of entries) {
          items.push({ repoName: repo.manifest!.name, slug: repoSlug, cid, commit });
        }
      } catch {
        /* skip */
      }
    });
    await Promise.all(tasks);

    // Sort by timestamp descending
    items.sort(
      (a, b) => new Date(b.commit.timestamp).getTime() - new Date(a.commit.timestamp).getTime(),
    );
    const recent = items.slice(0, 20);

    if (recent.length === 0) {
      render(
        container,
        el('h2', { cls: 'section-title', text: 'Recent Activity' }),
        el('p', { cls: 'empty-state', text: 'No activity yet.' }),
      );
      return;
    }

    // Group by day and build feed items
    const feedElements: HTMLElement[] = [];
    let lastDay = '';
    for (const item of recent) {
      const day = dayLabel(item.commit.timestamp);
      if (day !== lastDay) {
        feedElements.push(el('div', { cls: 'day-separator', text: day }));
        lastDay = day;
      }
      feedElements.push(
        el('a', {
          cls: 'commit-item',
          attrs: { href: `/${item.slug}/commit/${item.cid}` },
          children: [
            el('div', {
              cls: 'commit-item-header',
              children: [
                el('span', { cls: 'commit-message', text: item.commit.message }),
                el('a', {
                  cls: 'badge',
                  text: item.repoName,
                  attrs: { href: `/${item.slug}` },
                  onclick: (e: MouseEvent) => e.stopPropagation(),
                }),
              ],
            }),
            el('div', {
              cls: 'commit-item-meta',
              children: [
                (() => {
                  const s = el('span');
                  fillUserIdentity(s, item.commit.author);
                  return s;
                })(),
                el('span', { text: ` \u00b7 ${timeAgo(item.commit.timestamp)}` }),
              ],
            }),
          ],
        }),
      );
    }

    render(
      container,
      el('h2', { cls: 'section-title', text: 'Recent Activity' }),
      el('div', { cls: 'commit-list', children: feedElements }),
    );
  } catch {
    render(container, el('p', { cls: 'empty-state', text: 'Could not load activity.' }));
  }
}

/** Load repos from followed creators. */
async function loadFollowingFeed(container: HTMLElement, addresses: string[]): Promise<void> {
  try {
    const { repos } = await listRepos(100);
    const lowerSet = new Set(addresses.map((a) => a.toLowerCase()));

    const followed = repos.filter((r) =>
      r.manifest?.acl.owners.some((a) => lowerSet.has(a.toLowerCase())),
    );

    if (followed.length === 0) {
      render(
        container,
        el('h2', { cls: 'section-title', text: 'Following' }),
        el('p', { cls: 'empty-state', text: 'No new repos from creators you follow.' }),
      );
      return;
    }

    render(
      container,
      el('h2', { cls: 'section-title', text: 'Following' }),
      el('div', { cls: 'repo-list', children: repoCards(followed) }),
    );
  } catch {
    render(container, el('p', { cls: 'empty-state', text: 'Could not load following feed.' }));
  }
}

/** Day label for activity feed grouping. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Fetch head commit timestamp for a repo (best-effort). */
async function fetchRepoTimestamp(repo: {
  groupId: string;
  manifest: Manifest | null;
}): Promise<string | null> {
  if (!repo.manifest) return null;
  const headCid = repo.manifest.branches[repo.manifest.defaultBranch];
  if (!headCid) return null;
  try {
    const commit = await fetchJSON<Commit>(headCid);
    return commit.timestamp;
  } catch {
    return null;
  }
}

/** Fetch and render the list of repositories with pagination. */
async function loadRepoList(container: HTMLElement, heroStats?: HTMLElement): Promise<void> {
  try {
    const [{ repos, nextOffset, total }, platformResult] = await Promise.all([
      listRepos(10),
      fetchPlatformSettings().catch(() => null),
    ]);
    const pinnedRepoId = platformResult?.settings.pinnedRepo || '';

    // Update hero stat counter
    if (heroStats && total != null) {
      heroStats.innerHTML = '';
      heroStats.appendChild(el('strong', { text: String(total) }));
      heroStats.appendChild(
        document.createTextNode(` repo${total !== 1 ? 's' : ''} on the network`),
      );
    }

    if (repos.length === 0) {
      render(
        container,
        el('h2', { cls: 'section-title', text: 'Repositories' }),
        el('p', { cls: 'empty-state', text: 'No repositories found.' }),
      );
      return;
    }

    // If the pinned repo isn't in the initial batch, fetch it separately
    if (pinnedRepoId && !repos.some((r) => r.groupId === pinnedRepoId)) {
      try {
        const m = await fetchManifest(pinnedRepoId);
        if (m) {
          repos.unshift({ groupId: pinnedRepoId, groupName: m.name, manifest: m });
        }
      } catch {
        /* pinned repo may have been deleted */
      }
    }

    // Fetch head commit timestamps and sort by latest, pinned repo always first
    const timestamps = new Map<string, string>();
    await Promise.all(
      repos.map(async (repo) => {
        const ts = await fetchRepoTimestamp(repo);
        if (ts) timestamps.set(repo.groupId, ts);
      }),
    );
    repos.sort((a, b) => {
      if (pinnedRepoId) {
        if (a.groupId === pinnedRepoId) return -1;
        if (b.groupId === pinnedRepoId) return 1;
      }
      const ta = timestamps.get(a.groupId) ?? '';
      const tb = timestamps.get(b.groupId) ?? '';
      return tb.localeCompare(ta);
    });

    // All loaded repos (grows as user clicks "Load more")
    let allRepos = [...repos];

    const listEl = el('div', {
      cls: 'repo-list',
      children: repoCards(repos, timestamps, pinnedRepoId),
    });

    // Load stars + README previews in background
    loadRepoCardStars(repos, listEl);
    loadReadmePreviews(repos, listEl);

    const loadMoreContainer = el('div', { cls: 'load-more-container' });
    if (nextOffset !== null) {
      appendLoadMore(loadMoreContainer, listEl, nextOffset, allRepos, pinnedRepoId);
    }

    const searchInput = el('input', {
      cls: 'repo-search-input',
      attrs: { type: 'text', placeholder: 'Filter by name or owner address\u2026' },
    }) as HTMLInputElement;

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        // Restore full list
        listEl.innerHTML = '';
        for (const card of repoCards(allRepos, timestamps, pinnedRepoId)) listEl.appendChild(card);
        loadRepoCardStars(allRepos, listEl);
        loadReadmePreviews(allRepos, listEl);
        loadMoreContainer.style.display = '';
        return;
      }
      const filtered = allRepos.filter((r) => {
        const name = (r.manifest?.name ?? r.groupName).toLowerCase();
        const owners = r.manifest?.acl?.owners?.map((a) => a.toLowerCase()) ?? [];
        return (
          name.includes(q) ||
          r.groupId.toLowerCase().includes(q) ||
          owners.some((o) => o.includes(q))
        );
      });
      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.appendChild(el('p', { cls: 'empty-state', text: 'No matching repositories.' }));
      } else {
        for (const card of repoCards(filtered, timestamps)) listEl.appendChild(card);
        loadRepoCardStars(filtered, listEl);
        loadReadmePreviews(filtered, listEl);
      }
      loadMoreContainer.style.display = 'none';
    });

    render(
      container,
      el('h2', { cls: 'section-title', text: 'Latest Repositories' }),
      searchInput,
      listEl,
      loadMoreContainer,
    );
  } catch (err) {
    render(container, errorBox(`Failed to load repositories: ${err}`));
  }
}

/** Build repo card elements. */
export function repoCards(
  repos: Array<{ groupId: string; groupName: string; manifest: Manifest | null }>,
  timestamps?: Map<string, string>,
  pinnedRepoId?: string,
): HTMLElement[] {
  return repos.map((repo) => {
    const name = repo.manifest?.name ?? repo.groupName;
    const desc = repo.manifest?.description || 'No description';
    const branchCount = repo.manifest ? Object.keys(repo.manifest.branches).length : 0;
    const defaultBranch = repo.manifest?.defaultBranch || 'main';
    const isPrivate = repo.manifest?.visibility === 'private';
    const isPinned = pinnedRepoId ? repo.groupId === pinnedRepoId : false;

    const nameGroup: HTMLElement[] = [el('span', { cls: 'repo-card-name', text: name })];
    if (isPinned) {
      nameGroup.push(el('span', { cls: 'badge badge-pinned', text: '\uD83D\uDCCC Pinned' }));
    }
    if (isPrivate) {
      nameGroup.push(el('span', { cls: 'badge badge-private', text: '\uD83D\uDD12 Private' }));
    }
    const headerChildren: HTMLElement[] = [
      el('div', { cls: 'repo-card-name-group', children: nameGroup }),
    ];
    if (branchCount > 0) {
      headerChildren.push(
        el('span', {
          cls: 'repo-card-branches',
          text: `${branchCount} branch${branchCount !== 1 ? 'es' : ''}`,
        }),
      );
    }

    // Owner identity row
    const ownerAddr = repo.manifest?.acl?.owners?.[0];
    const ownerRow = el('div', { cls: 'repo-card-owner' });
    if (ownerAddr) fillUserIdentity(ownerRow, ownerAddr);

    // Meta row: stars (filled async) + updated time
    const metaChildren: HTMLElement[] = [
      el('span', {
        cls: 'repo-card-stars zero',
        attrs: { 'data-repo-id': repo.groupId },
        children: [el('span', { text: '\u2606' }), el('span', { text: '0' })],
      }),
    ];
    const ts = timestamps?.get(repo.groupId);
    if (ts) {
      metaChildren.push(el('span', { cls: 'repo-card-updated', text: `Updated ${timeAgo(ts)}` }));
    }
    metaChildren.push(
      el('span', {
        cls: 'repo-card-id',
        text: shortCid(repo.groupId, 6),
        attrs: { title: repo.groupId },
      }),
    );

    const repoSlug = slugify(name);
    return el('a', {
      cls: 'repo-card',
      attrs: { href: buildPath(repoSlug, defaultBranch), 'data-slug': repoSlug },
      children: [
        el('div', { cls: 'repo-card-header', children: headerChildren }),
        el('p', { cls: 'repo-card-desc', text: desc }),
        ownerRow,
        el('div', { cls: 'repo-card-meta', children: metaChildren }),
      ],
    });
  });
}

/** Load star counts for repo cards (best-effort, non-blocking). */
async function loadRepoCardStars(
  repos: Array<{ groupId: string; groupName: string; manifest: Manifest | null }>,
  listEl: HTMLElement,
): Promise<void> {
  await Promise.all(
    repos.slice(0, 20).map(async (repo) => {
      try {
        const { count } = await getRepoStars(repo.groupId);
        const badge = listEl.querySelector(`.repo-card-stars[data-repo-id="${repo.groupId}"]`);
        if (!badge) return;
        badge.innerHTML = '';
        badge.appendChild(el('span', { text: count > 0 ? '\u2605' : '\u2606' }));
        badge.appendChild(el('span', { text: String(count) }));
        if (count > 0) badge.classList.remove('zero');
      } catch {
        /* skip */
      }
    }),
  );
}

/** Load README snippets for each repo card (best-effort, non-blocking). */
async function loadReadmePreviews(
  repos: Array<{ groupId: string; groupName: string; manifest: Manifest | null }>,
  listEl: HTMLElement,
): Promise<void> {
  for (const repo of repos.slice(0, 10)) {
    if (!repo.manifest) continue;
    const headCid = repo.manifest.branches[repo.manifest.defaultBranch];
    if (!headCid) continue;
    try {
      const commit = await fetchJSON<Commit>(headCid);
      const tree = await fetchJSON<Tree>(commit.tree);
      const readme = tree.entries.find((e) => e.kind === 'blob' && /^readme\.md$/i.test(e.name));
      if (!readme) continue;
      const text = await fetchText(readme.cid);
      const stripped = text
        .replace(/^#+\s.*\n?/gm, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]*)\*\*/g, '$1')
        .replace(/\*([^*]*)\*/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/^[-*>]\s?/gm, '')
        .replace(/---+/g, '')
        .replace(/\n{2,}/g, ' ')
        .trim();
      const snippet = stripped.slice(0, 120);
      if (!snippet) continue;

      // Find matching card and append snippet
      const repoSlug = slugify(repo.manifest.name);
      const cards = listEl.querySelectorAll('.repo-card');
      for (const card of cards) {
        if ((card as HTMLElement).dataset.slug === repoSlug) {
          const preview = el('p', {
            cls: 'repo-card-readme',
            text: snippet + (stripped.length > 120 ? '...' : ''),
          });
          card.appendChild(preview);
          break;
        }
      }
    } catch {
      /* skip */
    }
  }
}

// ---------------------------------------------------------------------------
// Marquee ticker — aggregates discovery signals into a scrolling ribbon
// ---------------------------------------------------------------------------

/** Ticker item type. */
type TickerItem = {
  icon: string;
  label: string;
  href: string;
  kind: 'repo' | 'star' | 'follow' | 'network' | 'commit' | 'status';
};

/** Build the auto-scrolling marquee. */
async function loadMarquee(wrapper: HTMLElement): Promise<void> {
  const items: TickerItem[] = [];

  // Gather data in parallel — each source is best-effort
  const selfAddr = connectedAddress();
  const following = getFollowing();

  const [repoResult, peersResult, starredResult] = await Promise.allSettled([
    listRepos(30),
    fetchFederatedPeers(),
    selfAddr && hasSession() ? getStarredRepos(selfAddr) : Promise.resolve([]),
  ]);

  // 1. Latest public repos
  const repos: RepoSummary[] = repoResult.status === 'fulfilled' ? repoResult.value.repos : [];
  for (const repo of repos.slice(0, 8)) {
    if (!repo.manifest || repo.manifest.visibility === 'private') continue;
    items.push({
      icon: '\uD83D\uDCC2',
      label: repo.manifest.name,
      href: `/${slugify(repo.manifest.name)}`,
      kind: 'repo',
    });
  }

  // 2. Starred repos (resolve names async)
  const starredIds: string[] = starredResult.status === 'fulfilled' ? starredResult.value : [];
  const starredTasks = starredIds.slice(0, 6).map(async (id) => {
    try {
      const m = await fetchManifest(id);
      if (m && m.visibility !== 'private') {
        items.push({
          icon: '\u2B50',
          label: m.name,
          href: `/${slugify(m.name)}`,
          kind: 'star',
        });
      }
    } catch {
      /* skip */
    }
  });
  await Promise.allSettled(starredTasks);

  // 3. Followed users
  const followTasks = following.slice(0, 6).map(async (addr) => {
    try {
      const alias = await fetchAlias(addr);
      const display = alias || `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
      items.push({
        icon: '\uD83D\uDC64',
        label: display,
        href: `/user/${addr}`,
        kind: 'follow',
      });
    } catch {
      /* skip */
    }
  });
  await Promise.allSettled(followTasks);

  // 4. Federated peers + their repos
  const peers = peersResult.status === 'fulfilled' ? peersResult.value : [];
  for (const peer of peers.slice(0, 4)) {
    if (peer.status !== 'online') continue;
    items.push({
      icon: '\uD83C\uDF10',
      label: `${peer.name} (${peer.repoCount})`,
      href: `https://${peer.domain}`,
      kind: 'network',
    });
    // Surface federated repos as network pills
    for (const repo of peer.repos.slice(0, 3)) {
      items.push({
        icon: '\uD83D\uDD17',
        label: `${repo.name} \u00B7 ${peer.domain}`,
        href: `https://${peer.domain}/${slugify(repo.name)}`,
        kind: 'network',
      });
    }
  }

  // 5. Recent commits (from first few repos)
  for (const repo of repos.slice(0, 5)) {
    if (!repo.manifest) continue;
    const headCid = repo.manifest.branches[repo.manifest.defaultBranch];
    if (!headCid) continue;
    try {
      const commit = await fetchJSON<Commit>(headCid);
      const msg =
        commit.message.length > 40 ? commit.message.slice(0, 37) + '\u2026' : commit.message;
      items.push({
        icon: '\uD83D\uDD38',
        label: `${repo.manifest.name}: ${msg}`,
        href: `/${slugify(repo.manifest.name)}/commit/${headCid}`,
        kind: 'commit',
      });
    } catch {
      /* skip */
    }
  }

  // 6. Service status endpoints
  for (const ep of STATUS_ENDPOINTS) {
    items.push({
      icon: '\u2713',
      label: `${ep.name}: Operational`,
      href: ep.url,
      kind: 'status',
    });
  }

  if (items.length === 0) return;

  // Shuffle to mix categories
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  // Build pill elements
  const buildPills = () =>
    items.map((item) => {
      const isExternal = item.href.startsWith('http');
      return el('a', {
        cls: `marquee-pill marquee-pill-${item.kind}`,
        attrs: {
          href: item.href,
          ...(isExternal ? { target: '_blank', rel: 'noopener' } : {}),
        },
        children: [
          el('span', { cls: 'marquee-pill-icon', text: item.icon }),
          el('span', { text: item.label }),
        ],
      });
    });

  // Duplicate content for seamless loop
  const track = el('div', {
    cls: 'marquee-track',
    children: [...buildPills(), ...buildPills()],
  });

  // Pause on hover
  track.addEventListener('mouseenter', () => (track.style.animationPlayState = 'paused'));
  track.addEventListener('mouseleave', () => (track.style.animationPlayState = 'running'));

  wrapper.appendChild(track);
}

/** Append a "Load more" button that fetches the next page. */
function appendLoadMore(
  container: HTMLElement,
  listEl: HTMLElement,
  offset: number,
  allRepos: Array<{ groupId: string; groupName: string; manifest: Manifest | null }>,
  pinnedRepoId?: string,
): void {
  const btn = el('button', {
    cls: 'wallet-btn load-more-btn',
    text: 'Load more',
    onclick: async () => {
      btn.textContent = 'Loading...';
      (btn as HTMLButtonElement).disabled = true;
      try {
        const { repos, nextOffset } = await listRepos(20, offset);

        // Filter out the pinned repo if it was already prepended
        const filtered = pinnedRepoId ? repos.filter((r) => r.groupId !== pinnedRepoId) : repos;

        // Fetch timestamps and sort by latest before appending
        const timestamps = new Map<string, string>();
        await Promise.all(
          filtered.map(async (repo) => {
            const ts = await fetchRepoTimestamp(repo);
            if (ts) timestamps.set(repo.groupId, ts);
          }),
        );
        filtered.sort((a, b) => {
          const ta = timestamps.get(a.groupId) ?? '';
          const tb = timestamps.get(b.groupId) ?? '';
          return tb.localeCompare(ta);
        });

        allRepos.push(...filtered);
        for (const card of repoCards(filtered, timestamps, pinnedRepoId)) {
          listEl.appendChild(card);
        }
        loadRepoCardStars(filtered, listEl);
        loadReadmePreviews(filtered, listEl);
        container.innerHTML = '';
        if (nextOffset !== null) {
          appendLoadMore(container, listEl, nextOffset, allRepos, pinnedRepoId);
        }
      } catch (err) {
        btn.textContent = `Error: ${err}`;
      }
    },
  });
  container.appendChild(btn);
}
