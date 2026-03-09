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

/** Fetch JSON from IPFS with edge caching. */
async function fetchJSON<T>(env: Env, cid: string, cacheTtl = 300): Promise<T> {
  const headers: Record<string, string> = {};
  if (env.PINATA_JWT) headers['Authorization'] = `Bearer ${env.PINATA_JWT}`;
  const res = await fetch(gwUrl(env, cid), { headers, cf: { cacheTtl } } as RequestInit);
  if (!res.ok) throw new Error(`IPFS fetch failed: ${cid} (${res.status})`);
  return res.json() as Promise<T>;
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
async function resolveFile(env: Env, treeCid: string, filePath: string): Promise<string | null> {
  const segments = filePath.split('/').filter(Boolean);
  let currentTreeCid = treeCid;

  for (let i = 0; i < segments.length; i++) {
    const tree = await fetchJSON<Tree>(env, currentTreeCid);
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
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Landing page
    if (parts.length === 0) {
      return htmlResponse(landingHtml(pagesHost), 200, {
        'Cache-Control': 'public, max-age=3600',
      });
    }

    const slug = parts[0].toLowerCase();
    const filePath = parts.slice(1).join('/') || 'index.html';

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
        const folderCid = await resolveSubtree(env, treeCid, folder);
        if (!folderCid) {
          return htmlResponse(notFoundHtml(slug), 404);
        }
        treeCid = folderCid;
      }

      // 5. Resolve file in tree
      let blobCid = await resolveFile(env, treeCid, filePath);

      // Fallback: clean URL — try path.html (e.g. /about → about.html)
      if (!blobCid && !hasExtension(filePath)) {
        blobCid = await resolveFile(env, treeCid, filePath + '.html');
      }

      // Fallback: try path/index.html (directory index)
      if (!blobCid && !filePath.endsWith('/index.html')) {
        blobCid = await resolveFile(env, treeCid, filePath + '/index.html');
      }

      // Fallback: custom 404.html
      if (!blobCid) {
        const custom404 = await resolveFile(env, treeCid, '404.html');
        if (custom404) {
          const raw = await fetchRaw(env, custom404);
          return new Response(raw.body, {
            status: 404,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=60',
              'Access-Control-Allow-Origin': '*',
              ...SECURITY_HEADERS,
            },
          });
        }

        // Index fallback: serve root index.html for extensionless paths
        if (!hasExtension(filePath)) {
          const indexCid = await resolveFile(env, treeCid, 'index.html');
          if (indexCid) {
            const raw = await fetchRaw(env, indexCid);
            if (raw.ok) {
              return new Response(raw.body, {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'public, max-age=60',
                  'Access-Control-Allow-Origin': '*',
                  ...SECURITY_HEADERS,
                },
              });
            }
          }
        }

        return htmlResponse(notFoundHtml(slug), 404);
      }

      // 6. Serve the file
      const raw = await fetchRaw(env, blobCid);
      if (!raw.ok) {
        return new Response('File fetch failed', { status: 502 });
      }

      const ct = mimeType(filePath);
      const isHtml = ct.startsWith('text/html');
      return new Response(raw.body, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': isHtml ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          ...(isHtml ? SECURITY_HEADERS : { 'X-Content-Type-Options': 'nosniff' }),
        },
      });
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
async function resolveSubtree(env: Env, treeCid: string, folder: string): Promise<string | null> {
  const segments = folder.split('/').filter(Boolean);
  let current = treeCid;
  for (const seg of segments) {
    const tree = await fetchJSON<Tree>(env, current);
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
