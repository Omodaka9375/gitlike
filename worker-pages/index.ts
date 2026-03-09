// ---------------------------------------------------------------------------
// GitLike Pages — Static Site Worker
// Serves static websites from GitLike repos via IPFS.
// ---------------------------------------------------------------------------

import { mimeType } from './mime.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default pages host (overridable via env). */
const DEFAULT_PAGES_HOST = 'app.gitlike.dev';

/** Security headers applied to all HTML responses. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

type Env = {
  /** Shared KV namespace (pages:<slug> → groupId, manifest:<groupId> → CID). */
  SESSIONS: KVNamespace;
  /** Pinata API JWT. */
  PINATA_JWT: string;
  /** Pinata dedicated gateway domain. */
  PINATA_GATEWAY: string;
  /** Pages host domain (optional, defaults to app.gitlike.dev). */
  PAGES_HOST?: string;
};

// ---------------------------------------------------------------------------
// Types (minimal subset needed for tree walking)
// ---------------------------------------------------------------------------

type TreeEntry = { name: string; cid: string; kind: 'blob' | 'tree'; size?: number };
type Tree = { type: 'tree'; entries: TreeEntry[] };
type Commit = { type: 'commit'; tree: string; parents: string[] };
type Manifest = {
  type: 'manifest';
  name: string;
  defaultBranch: string;
  branches: Record<string, string>;
  pages?: { enabled: boolean; branch?: string; slug: string; spa?: boolean; folder?: string };
  visibility?: 'public' | 'private';
};

// ---------------------------------------------------------------------------
// Gateway helpers
// ---------------------------------------------------------------------------

/** Build an IPFS gateway URL. */
function gwUrl(env: Env, cid: string): string {
  const host = env.PINATA_GATEWAY || 'gateway.pinata.cloud';
  return `https://${host}/ipfs/${cid}`;
}

/** Per-request tree cache to avoid duplicate IPFS fetches. */
type TreeCache = Map<string, Tree>;

/** Fetch JSON from IPFS with edge caching. */
async function fetchJSON<T>(env: Env, cid: string, cacheTtl = 300): Promise<T> {
  const headers: Record<string, string> = {};
  if (env.PINATA_JWT) headers['Authorization'] = `Bearer ${env.PINATA_JWT}`;
  const res = await fetch(gwUrl(env, cid), { headers, cf: { cacheTtl } } as RequestInit);
  if (!res.ok) throw new Error(`IPFS fetch failed: ${cid} (${res.status})`);
  return res.json() as Promise<T>;
}

/** Fetch a tree with per-request caching. */
async function fetchTree(env: Env, cid: string, cache: TreeCache): Promise<Tree> {
  const hit = cache.get(cid);
  if (hit) return hit;
  const tree = await fetchJSON<Tree>(env, cid);
  cache.set(cid, tree);
  return tree;
}

/** Fetch raw bytes from IPFS. Returns the Response directly for streaming. */
async function fetchRaw(env: Env, cid: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (env.PINATA_JWT) headers['Authorization'] = `Bearer ${env.PINATA_JWT}`;
  return fetch(gwUrl(env, cid), { headers, cf: { cacheTtl: 86400 } } as RequestInit);
}

// ---------------------------------------------------------------------------
// Tree resolution
// ---------------------------------------------------------------------------

/**
 * Walk a tree to resolve a file path like "assets/css/style.css".
 * Returns the blob CID or null if not found.
 */
async function resolveFile(
  env: Env,
  treeCid: string,
  filePath: string,
  cache: TreeCache,
): Promise<string | null> {
  const segments = filePath.split('/').filter(Boolean);
  let currentTreeCid = treeCid;

  for (let i = 0; i < segments.length; i++) {
    const tree = await fetchTree(env, currentTreeCid, cache);
    const seg = segments[i];
    const entry = tree.entries.find((e) => e.name === seg);
    if (!entry) return null;

    if (i === segments.length - 1) {
      // Last segment — should be a blob
      return entry.kind === 'blob' ? entry.cid : null;
    }

    // Intermediate segment — must be a sub-tree
    if (entry.kind !== 'tree') return null;
    currentTreeCid = entry.cid;
  }

  return null;
}

/** Check if a URL path contains traversal segments. */
function hasTraversal(parts: string[]): boolean {
  return parts.some((p) => p === '..' || p === '.');
}

// ---------------------------------------------------------------------------
// Landing page HTML
// ---------------------------------------------------------------------------

function landingHtml(host: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GitLike Pages</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{text-align:center;max-width:480px;padding:2rem}
    h1{font-size:2rem;margin-bottom:.5rem}
    p{color:#8b949e;line-height:1.6;margin-bottom:1rem}
    code{background:#161b22;padding:.2em .5em;border-radius:4px;font-size:.9em}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="card">
    <h1>GitLike Pages</h1>
    <p>Host static websites directly from your GitLike repos.</p>
    <p>Enable Pages in your repo settings and your site will be live at<br/>
       <code>${host}/your-repo</code></p>
    <p><a href="https://gitlike.dev">Go to GitLike &rarr;</a></p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 404 page
// ---------------------------------------------------------------------------

function notFoundHtml(slug?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>404 — Not Found</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{text-align:center;max-width:480px;padding:2rem}
    h1{font-size:3rem;margin-bottom:.5rem}
    p{color:#8b949e;line-height:1.6}
    a{color:#58a6ff;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <p>${slug ? `Page not found in <strong>${escHtml(slug)}</strong>.` : 'Site not found.'}</p>
    <p><a href="https://gitlike.dev">Go to GitLike &rarr;</a></p>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const pagesHost = env.PAGES_HOST || DEFAULT_PAGES_HOST;
    const isHead = request.method === 'HEAD';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only GET / HEAD
    if (request.method !== 'GET' && !isHead) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Path traversal guard
    if (hasTraversal(parts)) {
      return new Response('Bad Request', { status: 400 });
    }

    // Landing page
    if (parts.length === 0) {
      return htmlResponse(landingHtml(pagesHost), 200, {
        'Cache-Control': 'public, max-age=3600',
      });
    }

    const slug = parts[0].toLowerCase();
    const filePath = parts.slice(1).join('/') || 'index.html';
    const cache: TreeCache = new Map();

    try {
      // 1. Resolve slug → groupId
      const groupId = await env.SESSIONS.get(`pages:${slug}`);
      if (!groupId) {
        return htmlResponse(notFoundHtml(), 404);
      }

      // 2. Get manifest CID from KV
      const manifestCid = await env.SESSIONS.get(`manifest:${groupId}`);
      if (!manifestCid) {
        return htmlResponse(notFoundHtml(slug), 404);
      }

      // 3. Fetch manifest — short edge cache
      const manifest = await fetchJSON<Manifest>(env, manifestCid, 60);

      // Verify pages is enabled and repo is public
      if (!manifest.pages?.enabled || manifest.visibility === 'private') {
        return htmlResponse(notFoundHtml(slug), 404);
      }

      const isSpa = !!manifest.pages.spa;

      // 4. Resolve branch → HEAD commit → tree
      const branch = manifest.pages.branch || manifest.defaultBranch;
      const commitCid = manifest.branches[branch];
      if (!commitCid) {
        return htmlResponse(notFoundHtml(slug), 404);
      }

      const commit = await fetchJSON<Commit>(env, commitCid, 60);
      let treeCid = commit.tree;

      // 4b. If a pages folder is configured, descend into it
      const folder = manifest.pages.folder;
      if (folder) {
        const folderCid = await resolveSubtree(env, treeCid, folder, cache);
        if (!folderCid) {
          return htmlResponse(notFoundHtml(slug), 404);
        }
        treeCid = folderCid;
      }

      // 5. Resolve file in tree
      let blobCid = await resolveFile(env, treeCid, filePath, cache);
      let servePath = filePath;

      // Fallback: clean URL — try path.html (e.g. /about → about.html)
      if (!blobCid && !hasExtension(filePath)) {
        blobCid = await resolveFile(env, treeCid, filePath + '.html', cache);
        if (blobCid) servePath = filePath + '.html';
      }

      // Fallback: try path/index.html (directory index)
      if (!blobCid && !filePath.endsWith('/index.html')) {
        blobCid = await resolveFile(env, treeCid, filePath + '/index.html', cache);
        if (blobCid) servePath = filePath + '/index.html';
      }

      // SPA fallback: serve root index.html for extensionless paths
      if (!blobCid && isSpa && !hasExtension(filePath)) {
        blobCid = await resolveFile(env, treeCid, 'index.html', cache);
        if (blobCid) servePath = 'index.html';
      }

      // 404 handling
      if (!blobCid) {
        // Try custom 404.html
        const custom404 = await resolveFile(env, treeCid, '404.html', cache);
        if (custom404) {
          return serveBlob(env, custom404, 'text/html; charset=utf-8', 404, custom404, isHead);
        }
        return htmlResponse(notFoundHtml(slug), 404);
      }

      // 6. ETag / conditional request
      const etag = `"${blobCid}"`;
      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      // 7. Serve the file
      const ct = mimeType(servePath);
      const isHtml = ct.startsWith('text/html');
      return serveBlob(env, blobCid, ct, 200, blobCid, isHead, isHtml);
    } catch (err) {
      console.error('Pages error:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Descend into a subfolder within a tree.
 * Returns the sub-tree CID or null if the folder doesn't exist.
 */
async function resolveSubtree(
  env: Env,
  treeCid: string,
  folder: string,
  cache: TreeCache,
): Promise<string | null> {
  const segments = folder.split('/').filter(Boolean);
  let current = treeCid;
  for (const seg of segments) {
    const tree = await fetchTree(env, current, cache);
    const entry = tree.entries.find((e) => e.name === seg && e.kind === 'tree');
    if (!entry) return null;
    current = entry.cid;
  }
  return current;
}

/** Check if a path has a file extension. */
function hasExtension(path: string): boolean {
  const last = path.split('/').pop() ?? '';
  return last.includes('.');
}

/** Serve a blob from IPFS with proper headers. */
async function serveBlob(
  env: Env,
  cid: string,
  contentType: string,
  status: number,
  etagCid: string,
  headOnly: boolean,
  isHtml = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control':
      isHtml || status === 404 ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    ETag: `"${etagCid}"`,
    ...(isHtml || status === 404 ? SECURITY_HEADERS : { 'X-Content-Type-Options': 'nosniff' }),
  };

  if (headOnly) {
    return new Response(null, { status, headers });
  }

  const raw = await fetchRaw(env, cid);
  if (!raw.ok) return new Response('File fetch failed', { status: 502 });
  return new Response(raw.body, { status, headers });
}

/** Build an HTML response with security headers. */
function htmlResponse(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}
