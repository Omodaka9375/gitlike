// ---------------------------------------------------------------------------
// GitLike — Cloudflare Worker Entry Point
// Hono router for /api/* with static asset fallthrough.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import { authRoutes } from './auth.js';
import { repoRoutes } from './operations.js';
import {
  securityHeaders,
  maxBodySize,
  requireAuth,
  requireAdmin,
  optionalAuth,
  validateAlias,
} from './middleware.js';
import { requestLogger } from './logger.js';
import { createStorage, fetchManifest, walkCommitHistory } from './ipfs.js';
import type { Manifest } from './ipfs.js';
import { generateRepoOgImage } from './og-image.js';
import { runMigrations } from './migrations.js';
import {
  getPlatformSettings,
  putPlatformSettings,
  getRole,
  isAdmin,
  canCreateRepo,
  type PlatformSettings,
} from './platform.js';
import {
  getProjectIndex,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectSlug,
  projectSlug,
  getProjectsForRepo,
  bootstrapProjectSlugs,
} from './projects.js';
import { getRepoIndex, getSlug, bootstrapSlugs } from './repo-index.js';
import { federationRoutes, syncAllPeers, buildWellKnownPayload } from './federation.js';
// Re-export Durable Object classes (required by Cloudflare Workers runtime)
export { RepoLock } from './repo-lock.js';
export { SocialLock } from './social-lock.js';

export type HonoEnv = { Bindings: Env; Variables: { address?: string } };

const app = new Hono<HonoEnv>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use('/api/*', async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN || '*';
  return cors({
    origin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});
app.use('/api/*', requestLogger);
app.use('/api/*', securityHeaders);
app.use('/api/*', maxBodySize);

// Global error handler — catches unhandled exceptions across all routes
app.onError((err, c) => {
  console.log(
    JSON.stringify({
      level: 'error',
      type: 'unhandled',
      message: err.message,
      stack: err.stack?.slice(0, 500),
      method: c.req.method,
      path: c.req.path,
    }),
  );
  return c.json({ error: 'Internal server error.' }, 500);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ ok: true }));

// Federation auto-discovery endpoint (enhanced with repo data)
app.get('/.well-known/gitlike.json', async (c) => {
  const settings = await getPlatformSettings(c.env.SESSIONS);
  const payload = await buildWellKnownPayload(c.env, settings.platformName);
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return c.json(payload);
});

app.get('/api/health/deep', async (c) => {
  const checks: Record<string, boolean> = { kv: false, storage: false };
  try {
    await c.env.SESSIONS.put('health:ping', 'ok', { expirationTtl: 60 });
    const val = await c.env.SESSIONS.get('health:ping');
    checks.kv = val === 'ok';
  } catch {
    /* KV unreachable */
  }

  try {
    const provider = createStorage(c.env);
    checks.storage = await provider.healthCheck();
  } catch {
    /* Storage unreachable */
  }

  const ok = checks.kv && checks.storage;
  return c.json({ ok, checks }, ok ? 200 : 503);
});

app.route('/api/auth', authRoutes);
app.route('/api/repos', repoRoutes);
app.route('/api/federation', federationRoutes);

// ---------------------------------------------------------------------------
// Platform settings routes
// ---------------------------------------------------------------------------

app.get('/api/platform/settings', optionalAuth, async (c) => {
  const settings = await getPlatformSettings(c.env.SESSIONS);
  const address = c.get('address');
  const role = await getRole(c.env, c.env.SESSIONS, address);
  return c.json({ settings, role });
});

app.get('/api/platform/usage', requireAdmin, async (c) => {
  try {
    const provider = createStorage(c.env);
    const usage = await provider.getUsage();
    return c.json(usage);
  } catch (err) {
    return c.json(
      { error: `Failed to fetch usage: ${err instanceof Error ? err.message : err}` },
      500,
    );
  }
});

app.put('/api/platform/settings', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<PlatformSettings>>();
  const current = await getPlatformSettings(c.env.SESSIONS);

  const updated: PlatformSettings = {
    openCreation: body.openCreation ?? current.openCreation,
    writers: Array.isArray(body.writers)
      ? body.writers.map((w) => w.trim()).filter(Boolean)
      : current.writers,
    platformName: body.platformName ?? current.platformName,
    platformDescription: body.platformDescription ?? current.platformDescription,
    retentionDepth: body.retentionDepth ?? current.retentionDepth,
  };

  await putPlatformSettings(c.env.SESSIONS, updated);
  return c.json({ settings: updated });
});

// ---------------------------------------------------------------------------
// Alias routes
// ---------------------------------------------------------------------------

app.get('/api/alias/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const [alias, pfp, bio] = await Promise.all([
    c.env.SESSIONS.get(`alias:${address}`),
    c.env.SESSIONS.get(`pfp:${address}`),
    c.env.SESSIONS.get(`bio:${address}`),
  ]);
  return c.json({ alias: alias ?? null, pfp: pfp ?? null, bio: bio ?? null });
});

app.put('/api/alias', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const body = await c.req.json<{ alias: string }>();
  const err = validateAlias(body.alias);
  if (err) return c.json({ error: err }, 400);
  await c.env.SESSIONS.put(`alias:${address}`, body.alias);
  return c.json({ ok: true, alias: body.alias });
});

/** Max bio length. */
const MAX_BIO = 160;

app.put('/api/bio', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const body = await c.req.json<{ bio: string }>();
  const bio = (body.bio ?? '').trim();
  if (bio.length > MAX_BIO)
    return c.json({ error: `Bio must be ${MAX_BIO} characters or fewer.` }, 400);
  if (bio) {
    await c.env.SESSIONS.put(`bio:${address}`, bio);
  } else {
    await c.env.SESSIONS.delete(`bio:${address}`);
  }
  return c.json({ ok: true, bio: bio || null });
});

/** Max PFP URL length. */
const MAX_PFP_URL = 512;

app.put('/api/pfp', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const body = await c.req.json<{ url?: string; ens?: boolean }>();

  let pfpUrl: string | null = null;

  if (body.ens) {
    // Resolve ENS avatar via ensdata.net
    try {
      const res = await fetch(`https://ensdata.net/${address}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { avatar?: string; avatar_url?: string };
        pfpUrl = data.avatar_url || data.avatar || null;
      }
    } catch {
      /* ENS resolution failed */
    }
    if (!pfpUrl) return c.json({ error: 'Could not resolve ENS avatar for this address.' }, 404);
  } else if (body.url) {
    const url = body.url.trim();
    if (url.length > MAX_PFP_URL) return c.json({ error: 'URL too long.' }, 400);
    if (!/^https?:\/\//i.test(url)) return c.json({ error: 'URL must start with http(s)://' }, 400);
    pfpUrl = url;
  } else {
    // Clear PFP
    await c.env.SESSIONS.delete(`pfp:${address}`);
    return c.json({ ok: true, pfp: null });
  }

  await c.env.SESSIONS.put(`pfp:${address}`, pfpUrl);
  return c.json({ ok: true, pfp: pfpUrl });
});

// ---------------------------------------------------------------------------
// Public key routes (for client-side encryption key exchange)
// ---------------------------------------------------------------------------

app.get('/api/pubkey/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return c.json({ error: 'Invalid address.' }, 400);
  }
  const pubkey = await c.env.SESSIONS.get(`pubkey:${address}`);
  if (!pubkey) return c.json({ error: 'Public key not found.' }, 404);
  return c.json({ address, pubkey });
});

app.put('/api/pubkey', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const body = await c.req.json<{ pubkey: string }>();
  if (!body.pubkey || typeof body.pubkey !== 'string' || body.pubkey.length > 200) {
    return c.json({ error: 'Invalid public key.' }, 400);
  }
  await c.env.SESSIONS.put(`pubkey:${address}`, body.pubkey);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Follow routes
// ---------------------------------------------------------------------------

/** Read a follow list from KV. */
async function readFollowList(kv: KVNamespace, key: string): Promise<string[]> {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/** Dispatch a social mutation to the SocialLock DO (serialized). */
function dispatchToSocialLock(
  env: Env,
  key: string,
  body: Record<string, string>,
): Promise<Response> {
  const id = env.SOCIAL_LOCK.idFromName(key);
  const stub = env.SOCIAL_LOCK.get(id);
  return stub.fetch(
    new Request('https://social-lock/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

app.post('/api/follow', requireAuth, async (c) => {
  const caller = (c.get('address') as string).toLowerCase();
  const body = await c.req.json<{ address: string }>();
  const target = body.address?.toLowerCase();
  if (!target || !/^0x[0-9a-f]{40}$/.test(target)) {
    return c.json({ error: 'Invalid address.' }, 400);
  }
  if (target === caller) return c.json({ error: 'Cannot follow yourself.' }, 400);

  const doRes = await dispatchToSocialLock(c.env, caller, {
    action: 'follow',
    caller,
    target,
  });
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

app.delete('/api/follow/:address', requireAuth, async (c) => {
  const caller = (c.get('address') as string).toLowerCase();
  const target = c.req.param('address').toLowerCase();
  if (!target || !/^0x[0-9a-f]{40}$/.test(target)) {
    return c.json({ error: 'Invalid address.' }, 400);
  }

  const doRes = await dispatchToSocialLock(c.env, caller, {
    action: 'unfollow',
    caller,
    target,
  });
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

app.get('/api/following/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const addresses = await readFollowList(c.env.SESSIONS, `following:${address}`);
  return c.json({ addresses, count: addresses.length });
});

app.get('/api/followers/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const addresses = await readFollowList(c.env.SESSIONS, `followers:${address}`);
  return c.json({ addresses, count: addresses.length });
});

// ---------------------------------------------------------------------------
// Contribution graph route
// ---------------------------------------------------------------------------

app.get('/api/user/:address/contributions', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;

  const [curRaw, prevRaw] = await Promise.all([
    c.env.SESSIONS.get(`activity:${address}:${currentYear}`),
    c.env.SESSIONS.get(`activity:${address}:${lastYear}`),
  ]);

  const curCounts: Record<string, number> = curRaw ? JSON.parse(curRaw) : {};
  const prevCounts: Record<string, number> = prevRaw ? JSON.parse(prevRaw) : {};
  const all = { ...prevCounts, ...curCounts };

  // Filter to last 365 days
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const contributions: Record<string, number> = {};
  for (const [date, count] of Object.entries(all)) {
    if (date >= cutoffStr) contributions[date] = count;
  }

  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return c.json({ contributions });
});

// ---------------------------------------------------------------------------
// Star routes
// ---------------------------------------------------------------------------

app.post('/api/repos/:id/star', requireAuth, async (c) => {
  const caller = (c.get('address') as string).toLowerCase();
  const groupId = c.req.param('id');

  const doRes = await dispatchToSocialLock(c.env, groupId, {
    action: 'star',
    caller,
    repoId: groupId,
  });
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

app.delete('/api/repos/:id/star', requireAuth, async (c) => {
  const caller = (c.get('address') as string).toLowerCase();
  const groupId = c.req.param('id');

  const doRes = await dispatchToSocialLock(c.env, groupId, {
    action: 'unstar',
    caller,
    repoId: groupId,
  });
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

app.get('/api/repos/:id/stars', optionalAuth, async (c) => {
  const groupId = c.req.param('id');
  const kv = c.env.SESSIONS;
  const stars = await readFollowList(kv, `stars:${groupId}`);

  const caller = c.get('address')?.toLowerCase();
  const isStarred = caller ? stars.includes(caller) : false;

  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  return c.json({ count: stars.length, starred: isStarred });
});

app.get('/api/user/:address/starred', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const repos = await readFollowList(c.env.SESSIONS, `starred:${address}`);
  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  return c.json({ repos });
});

// ---------------------------------------------------------------------------
// Project routes
// ---------------------------------------------------------------------------

// Resolve project slug → projectId
app.get('/api/projects/resolve/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  let projectId = await getProjectSlug(c.env, slug);
  if (!projectId) {
    // One-time migration: populate slugs from index
    await bootstrapProjectSlugs(c.env);
    projectId = await getProjectSlug(c.env, slug);
  }
  if (!projectId) return c.json({ error: 'Project not found.' }, 404);
  return c.json({ projectId });
});

app.get('/api/projects', optionalAuth, async (c) => {
  const index = await getProjectIndex(c.env);
  const addr = c.get('address')?.toLowerCase() ?? '';
  const ownerFilter = c.req.query('owner')?.toLowerCase();

  // Filter out private projects the caller cannot access
  let visible = index.filter((p) => {
    if (p.visibility !== 'private') return true;
    if (!addr) return false;
    return p.owner.toLowerCase() === addr;
  });

  // Optional owner filter
  if (ownerFilter) {
    visible = visible.filter((p) => p.owner.toLowerCase() === ownerFilter);
  }

  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  return c.json({ projects: visible });
});

app.get('/api/projects/:id', optionalAuth, async (c) => {
  const project = await getProject(c.env, c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found.' }, 404);

  const addr = c.get('address')?.toLowerCase() ?? '';

  // Block access to private projects for non-owners
  if (project.visibility === 'private') {
    if (!addr || project.owner.toLowerCase() !== addr) {
      return c.json({ error: 'Project not found.' }, 404);
    }
  }

  // Filter out private repo IDs the caller cannot access
  const repoIndex = await getRepoIndex(c.env);
  const accessibleRepos = project.repos.filter((repoId) => {
    const entry = repoIndex.find((e) => e.groupId === repoId);
    if (!entry) return true; // Unknown repo — keep it, manifest fetch will handle access
    if (entry.visibility !== 'private') return true;
    if (!addr) return false;
    return (
      entry.owner.toLowerCase() === addr ||
      (entry.writers ?? []).some((w) => w.toLowerCase() === addr)
    );
  });

  return c.json({ project: { ...project, repos: accessibleRepos } });
});

app.post('/api/projects', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();

  // Project creation follows the same platform-level gate as repo creation
  const allowed = await canCreateRepo(c.env, c.env.SESSIONS, address);
  if (!allowed) {
    return c.json({ error: 'Project creation is restricted. Contact the platform admin.' }, 403);
  }

  const body = await c.req.json<{
    name: string;
    description?: string;
    repos: string[];
    visibility?: 'public' | 'private';
  }>();

  const name = body.name?.trim();
  if (!name || name.length > 64) {
    return c.json({ error: 'Project name required (max 64 chars).' }, 400);
  }
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return c.json({ error: 'At least one repo is required.' }, 400);
  }

  // Check slug uniqueness
  const slug = projectSlug(name);
  if (slug) {
    const existing = await getProjectSlug(c.env, slug);
    if (existing) {
      return c.json({ error: `A project named "${name}" already exists.` }, 409);
    }
  }

  const project = await createProject(
    c.env,
    name,
    body.description?.trim() ?? '',
    body.repos,
    address,
    body.visibility === 'private' ? 'private' : 'public',
  );
  return c.json({ project }, 201);
});

app.patch('/api/projects/:id', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const project = await getProject(c.env, c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const isOwner = project.owner.toLowerCase() === address;
  if (!isOwner && !isAdmin(c.env, address)) {
    return c.json({ error: 'Only the project owner or platform admin can edit it.' }, 403);
  }

  const body = await c.req.json<{
    name?: string;
    description?: string;
    repos?: string[];
    visibility?: 'public' | 'private';
  }>();

  // If renaming, check slug uniqueness
  if (body.name && body.name.trim() !== project.name) {
    const newSlug = projectSlug(body.name.trim());
    if (newSlug) {
      const existing = await getProjectSlug(c.env, newSlug);
      if (existing && existing !== project.id) {
        return c.json({ error: `A project named "${body.name}" already exists.` }, 409);
      }
    }
  }

  const updated = await updateProject(c.env, project.id, body);
  if (!updated) return c.json({ error: 'Update failed.' }, 500);
  return c.json({ project: updated });
});

app.delete('/api/projects/:id', requireAuth, async (c) => {
  const address = (c.get('address') as string).toLowerCase();
  const project = await getProject(c.env, c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const isOwner = project.owner.toLowerCase() === address;
  if (!isOwner && !isAdmin(c.env, address)) {
    return c.json({ error: 'Only the project owner or platform admin can delete it.' }, 403);
  }
  await deleteProject(c.env, project.id);
  return c.json({ ok: true });
});

// Reverse lookup: which projects contain this repo?
app.get('/api/repos/:id/projects', async (c) => {
  const groupId = c.req.param('id');
  const projects = await getProjectsForRepo(c.env, groupId);
  c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  return c.json({ projects });
});

// Client-side error reporting — logs to Worker Logs for monitoring
app.post('/api/errors', async (c) => {
  try {
    const body = await c.req.json<{ message?: string; source?: string; url?: string }>();
    console.log(
      JSON.stringify({
        level: 'warn',
        type: 'client-error',
        message: String(body.message ?? '').slice(0, 500),
        source: body.source,
        url: body.url,
      }),
    );
  } catch {
    // Ignore malformed payloads
  }
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Avatar proxy — serves PFP images server-side to protect visitor privacy
// ---------------------------------------------------------------------------

/** Max avatar response size (2 MB). */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

app.get('/api/avatar/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const pfpUrl = await c.env.SESSIONS.get(`pfp:${address}`);
  if (!pfpUrl) return c.body(null, 404);

  // Validate URL scheme — only allow HTTPS
  let parsed: URL;
  try {
    parsed = new URL(pfpUrl);
  } catch {
    return c.body(null, 400);
  }
  if (parsed.protocol !== 'https:') return c.body(null, 400);

  // Block private/loopback IPs
  const host = parsed.hostname;
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return c.body(null, 400);
  }

  try {
    const res = await fetch(pfpUrl, {
      signal: AbortSignal.timeout(5000),
      cf: { cacheTtl: 3600 },
    } as RequestInit);
    if (!res.ok) return c.body(null, 502);

    const ct = res.headers.get('Content-Type') || '';
    if (!ct.startsWith('image/')) return c.body(null, 415);

    const cl = res.headers.get('Content-Length');
    if (cl && parseInt(cl, 10) > MAX_AVATAR_BYTES) return c.body(null, 413);

    return new Response(res.body, {
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return c.body(null, 502);
  }
});

// IPFS gateway proxy — avoids 403s from restricted dedicated gateways
app.get('/api/ipfs/:cid', async (c) => {
  const cid = c.req.param('cid');
  if (!cid || !/^baf/i.test(cid)) return c.json({ error: 'Invalid CID' }, 400);

  const gw = c.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
  const url = `https://${gw}/ipfs/${cid}`;
  const headers: Record<string, string> = {};
  if (c.env.PINATA_JWT) headers['Authorization'] = `Bearer ${c.env.PINATA_JWT}`;
  const res = await fetch(url, { headers, cf: { cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) return c.body(null, res.status as 404);

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// ---------------------------------------------------------------------------
// Creator Atom feed — repos owned by an address
// ---------------------------------------------------------------------------

app.get('/api/user/:address/feed', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const baseUrl = c.env.ALLOWED_ORIGIN || 'https://gitlike.dev';

  try {
    const index = await getRepoIndex(c.env);
    const ownedEntries = index.filter(
      (e) => e.visibility !== 'private' && e.owner.toLowerCase() === address,
    );
    const provider = createStorage(c.env);
    const owned: Array<{ groupId: string; manifest: Manifest | null }> = await Promise.all(
      ownedEntries.slice(0, 20).map(async (e) => ({
        groupId: e.groupId,
        manifest: await fetchManifest(provider, c.env, e.groupId),
      })),
    );

    // Gather latest commit per repo
    type FeedEntry = { name: string; groupId: string; message: string; author: string; ts: string };
    const entries: FeedEntry[] = [];
    for (const repo of owned) {
      const m = repo.manifest;
      if (!m) continue;
      const headCid = m.branches[m.defaultBranch];
      if (!headCid) continue;
      try {
        const history = await walkCommitHistory(c.env, headCid, 1);
        if (history.length > 0) {
          entries.push({
            name: m.name,
            groupId: repo.groupId,
            message: history[0].commit.message,
            author: history[0].commit.author,
            ts: history[0].commit.timestamp,
          });
        }
      } catch {
        /* skip */
      }
    }

    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const alias = await c.env.SESSIONS.get(`alias:${address}`);
    const displayName = alias || `${address.slice(0, 6)}...${address.slice(-4)}`;

    let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
    xml += `<feed xmlns="http://www.w3.org/2005/Atom">\n`;
    xml += `  <title>${escXml(displayName)} — GitLike Repos</title>\n`;
    xml += `  <link href="${baseUrl}/user/${address}" />\n`;
    xml += `  <id>urn:gitlike:user:${address}</id>\n`;
    xml += `  <updated>${entries[0]?.ts ?? new Date().toISOString()}</updated>\n`;

    for (const e of entries) {
      xml += `  <entry>\n`;
      xml += `    <title>${escXml(e.name)}</title>\n`;
      xml += `    <link href="${baseUrl}/${e.groupId}" />\n`;
      xml += `    <summary>${escXml(e.message)}</summary>\n`;
      xml += `    <author><name>${escXml(e.author)}</name></author>\n`;
      xml += `    <updated>${e.ts}</updated>\n`;
      xml += `    <id>urn:gitlike:${e.groupId}</id>\n`;
      xml += `  </entry>\n`;
    }
    xml += `</feed>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return c.json({ error: `Feed failed: ${err instanceof Error ? err.message : err}` }, 500);
  }
});

/** Escape XML special characters. */
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// OG image endpoint — branded SVG card per repo
// ---------------------------------------------------------------------------

app.get('/api/og/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.body('Not found', 404);
    if (manifest.visibility === 'private') return c.body('Not found', 404);
    const svg = generateRepoOgImage(manifest);
    return c.body(svg, 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
  } catch {
    return c.body('Error generating image', 500);
  }
});

// ---------------------------------------------------------------------------
// SPA catch-all — serve index.html, inject dynamic OG tags for repo paths
// ---------------------------------------------------------------------------

/** Detect repo path: /:slug or /:slug/:branch (slug = alphanumeric + hyphens, or UUID). */
const REPO_PATH_RE = /^\/([a-z0-9][a-z0-9-]{0,99})(?:\/(.+))?$/i;

/** Known static routes that should NOT be treated as repo slugs. */
const STATIC_ROUTES = new Set([
  'humans',
  'agents',
  'run-your-own',
  'cli-auth',
  'cli',
  'projects',
  'user',
  'api',
]);

app.get('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const match = REPO_PATH_RE.exec(pathname);

  // ASSETS binding is unavailable in wrangler dev — return 404 for non-API catch-all
  if (!c.env.ASSETS) return c.body('Not found', 404);

  // Fast path — non-repo route, serve plain SPA shell
  if (!match || STATIC_ROUTES.has(match[1].toLowerCase())) {
    const url = new URL('/index.html', c.req.url);
    return c.env.ASSETS.fetch(new Request(url));
  }

  const slugOrId = match[1];
  // Resolve slug → groupId (if it's already a UUID, getSlug returns null and we use it directly)
  const UUID_RE = /^[a-f0-9-]{36}$/i;
  let groupId: string | null = null;
  if (UUID_RE.test(slugOrId)) {
    groupId = slugOrId;
  } else {
    const lowerSlug = slugOrId.toLowerCase();
    groupId = await getSlug(c.env, lowerSlug);
    if (!groupId) {
      // One-time migration: populate slug mappings from index
      await bootstrapSlugs(c.env);
      groupId = await getSlug(c.env, lowerSlug);
    }
  }
  const origin = c.env.ALLOWED_ORIGIN || new URL(c.req.url).origin;

  // Fetch the SPA HTML shell
  const spaShell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  let html = await spaShell.text();

  try {
    if (!groupId) throw new Error('slug not resolved');
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);

    if (manifest && manifest.visibility !== 'private') {
      const title = `${manifest.name} — GitLike`;
      const desc = manifest.description || 'Decentralized repository on GitLike.';
      const ogImg = `${origin}/api/og/${groupId}`;
      const repoUrl = `${origin}/${groupId}`;

      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
        .replace(
          /<meta name="description"[^>]*>/,
          `<meta name="description" content="${esc(desc)}" />`,
        )
        .replace(
          /<meta property="og:title"[^>]*>/,
          `<meta property="og:title" content="${esc(title)}" />`,
        )
        .replace(
          /<meta property="og:description"[^>]*>/,
          `<meta property="og:description" content="${esc(desc)}" />`,
        )
        .replace(
          /<meta property="og:image"[^>]*>/,
          `<meta property="og:image" content="${ogImg}" />`,
        )
        .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${repoUrl}" />`)
        .replace(
          /<meta name="twitter:title"[^>]*>/,
          `<meta name="twitter:title" content="${esc(title)}" />`,
        )
        .replace(
          /<meta name="twitter:description"[^>]*>/,
          `<meta name="twitter:description" content="${esc(desc)}" />`,
        )
        .replace(
          /<meta name="twitter:image"[^>]*>/,
          `<meta name="twitter:image" content="${ogImg}" />`,
        );
    }
  } catch {
    // On error, serve the default SPA shell — OG tags stay generic
  }

  return c.html(html);
});

/** Escape HTML attribute value. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Scheduled handler — daily manifest backup
// ---------------------------------------------------------------------------

const worker = {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    // Run pending KV schema migrations
    try {
      const applied = await runMigrations(env);
      if (applied > 0) {
        console.log(JSON.stringify({ level: 'info', type: 'migrations', applied }));
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          type: 'migrations',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Federation peer sync
    try {
      const synced = await syncAllPeers(env.SESSIONS);
      if (synced > 0) {
        console.log(JSON.stringify({ level: 'info', type: 'federation-sync', synced }));
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          type: 'federation-sync',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Daily manifest backup
    try {
      const index = await getRepoIndex(env);
      const snapshot: Record<string, string> = {};
      for (const entry of index) {
        const cid = await env.SESSIONS.get(`manifest:${entry.groupId}`);
        if (cid) snapshot[entry.groupId] = cid;
      }
      const ts = new Date().toISOString().slice(0, 10);
      await env.SESSIONS.put(`backup:manifests:${ts}`, JSON.stringify(snapshot), {
        expirationTtl: 30 * 86_400,
      });
      console.log(
        JSON.stringify({
          level: 'info',
          type: 'backup',
          repos: Object.keys(snapshot).length,
          date: ts,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          type: 'backup',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  },
};

export default worker;
