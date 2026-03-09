// ---------------------------------------------------------------------------
// GitLike — SPA Router (pushState)
// Parses: /<slug>/<branch>/path/to/file
// Views: "home" | "repo" | "tree" | "blob" | "commits"
// ---------------------------------------------------------------------------

/** All possible view types. */
export type View =
  | 'home'
  | 'how'
  | 'agents'
  | 'run-your-own'
  | 'cli-auth'
  | 'repo'
  | 'tree'
  | 'blob'
  | 'commits'
  | 'commit'
  | 'user'
  | 'stars'
  | 'prs'
  | 'pr'
  | 'history'
  | 'projects'
  | 'project'
  | 'cli';

/** Parsed route state. */
export type Route = {
  view: View;
  /** Resolved groupId (populated after slug resolution). */
  groupId: string;
  /** URL slug (repo name or legacy UUID). */
  slug: string;
  branch: string;
  path: string;
  /** Segments of path split by "/". */
  segments: string[];
  /** Commit CID for commit detail view. */
  commitCid?: string;
  /** Address for user profile view. */
  address?: string;
  /** PR CID for PR detail view. */
  prCid?: string;
  /** Project slug for project views. */
  projectSlug?: string;
};

/** Default route when no path is present. */
const HOME_ROUTE: Route = {
  view: 'home',
  groupId: '',
  slug: '',
  branch: '',
  path: '',
  segments: [],
};

/** Parse a pathname into a Route. */
export function parsePath(pathname: string): Route {
  const raw = pathname.split(/[?#]/)[0].replace(/^\//, '');
  if (!raw) return HOME_ROUTE;

  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) return HOME_ROUTE;

  // /humans — for humans page
  if (parts[0] === 'humans') {
    return { view: 'how', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /agents — for agents page
  if (parts[0] === 'agents') {
    return { view: 'agents', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /run-your-own — self-hosting & federation
  if (parts[0] === 'run-your-own') {
    return { view: 'run-your-own', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /cli-auth — CLI browser auth callback
  if (parts[0] === 'cli-auth') {
    return { view: 'cli-auth', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /cli — CLI usage guide
  if (parts[0] === 'cli') {
    return { view: 'cli', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /projects — project list
  if (parts[0] === 'projects' && !parts[1]) {
    return { view: 'projects', groupId: '', slug: '', branch: '', path: '', segments: [] };
  }

  // /projects/:slug — project detail
  if (parts[0] === 'projects' && parts[1]) {
    return {
      view: 'project',
      groupId: '',
      slug: '',
      branch: '',
      path: '',
      segments: [],
      projectSlug: parts[1],
    };
  }

  // /user/<address>/stars — starred repos
  if (parts[0] === 'user' && parts[1] && parts[2] === 'stars') {
    return {
      view: 'stars',
      groupId: '',
      slug: '',
      branch: '',
      path: '',
      segments: [],
      address: parts[1],
    };
  }

  // /user/<address> — user profile
  if (parts[0] === 'user' && parts[1]) {
    return {
      view: 'user',
      groupId: '',
      slug: '',
      branch: '',
      path: '',
      segments: [],
      address: parts[1],
    };
  }

  const slug = parts[0];
  const groupId = '';

  // /<slug>/commits — commit log view
  if (parts[1] === 'commits') {
    return { view: 'commits', groupId, slug, branch: parts[2] || 'main', path: '', segments: [] };
  }

  // /<slug>/commit/<cid> — commit detail view
  if (parts[1] === 'commit' && parts[2]) {
    return {
      view: 'commit',
      groupId,
      slug,
      branch: '',
      path: '',
      segments: [],
      commitCid: parts[2],
    };
  }

  // /<slug>/history/<branch>/<path> — file history
  if (parts[1] === 'history' && parts[2]) {
    const histBranch = parts[2];
    const histPath = parts.slice(3).join('/');
    return {
      view: 'history',
      groupId,
      slug,
      branch: histBranch,
      path: histPath,
      segments: parts.slice(3),
    };
  }

  // /<slug>/prs — pull request list
  if (parts[1] === 'prs') {
    return { view: 'prs', groupId, slug, branch: '', path: '', segments: [] };
  }

  // /<slug>/pr/<cid> — pull request detail
  if (parts[1] === 'pr' && parts[2]) {
    return { view: 'pr', groupId, slug, branch: '', path: '', segments: [], prCid: parts[2] };
  }

  const branch = parts[1] || 'main';
  const pathSegments = parts.slice(2);
  const path = pathSegments.join('/');

  if (pathSegments.length === 0) {
    return { view: 'repo', groupId, slug, branch, path: '', segments: [] };
  }

  // We don't know if the last segment is a file or directory until we fetch.
  // Default to 'tree' — the renderer will switch to 'blob' if it resolves to a file.
  return { view: 'tree', groupId, slug, branch, path, segments: pathSegments };
}

/** Build a path URL for navigation. */
export function buildPath(groupId: string, branch = 'main', path = ''): string {
  const b = branch || 'main';
  const base = `/${groupId}/${b}`;
  return path ? `${base}/${path}` : base;
}

/** Build a path URL for the commit log. */
export function buildCommitsPath(groupId: string, branch = 'main'): string {
  return `/${groupId}/commits/${branch}`;
}

/** Current route from the pathname. */
export function currentRoute(): Route {
  return parsePath(window.location.pathname);
}

type RouteHandler = (route: Route) => void;

let _routeHandler: RouteHandler | null = null;

/** Navigate to a path via pushState and trigger the route handler. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  if (_routeHandler) _routeHandler(parsePath(path));
}

/** Trigger a re-render of the current route. */
export function refreshRoute(): void {
  if (_routeHandler) _routeHandler(currentRoute());
}

/** Subscribe to route changes (popstate + link clicks). Returns an unsubscribe function. */
export function onRouteChange(handler: RouteHandler): () => void {
  _routeHandler = handler;

  // Back/forward navigation
  const onPop = () => handler(parsePath(window.location.pathname));
  window.addEventListener('popstate', onPop);

  // Intercept same-origin <a> clicks for SPA navigation
  const onClick = (e: MouseEvent) => {
    // Only plain left-clicks (no modifier keys)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:')) {
      return;
    }
    // Skip non-SPA paths (API, static assets)
    if (href.startsWith('/api/') || href.startsWith('/dist/')) return;

    e.preventDefault();
    navigate(href);
  };
  document.addEventListener('click', onClick);

  return () => {
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('click', onClick);
    _routeHandler = null;
  };
}
