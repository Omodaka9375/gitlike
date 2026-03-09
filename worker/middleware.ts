// ---------------------------------------------------------------------------
// GitLike — Worker Middleware
// Auth guard, security headers, rate limiting.
// ---------------------------------------------------------------------------

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { HonoEnv } from './index.js';

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export const securityHeaders: MiddlewareHandler<HonoEnv> = async (
  c: Context<HonoEnv>,
  next: Next,
) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://api.github.com https://gitlab.com https://uploads.pinata.cloud",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
};

// ---------------------------------------------------------------------------
// Auth guard — requires valid session token
// ---------------------------------------------------------------------------

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const token = header.slice(7);
  const address = await c.env.SESSIONS.get(`session:${token}`);
  if (!address) {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  c.set('address', address);
  await next();
};

// ---------------------------------------------------------------------------
// Optional auth — sets address if token is valid, but does not reject
// ---------------------------------------------------------------------------

export const optionalAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    const address = await c.env.SESSIONS.get(`session:${token}`);
    if (address) c.set('address', address);
  }
  await next();
};

// ---------------------------------------------------------------------------
// Repo access guard — blocks unauthenticated access to private repos
// ---------------------------------------------------------------------------

import type { Manifest } from './ipfs.js';
import { isDelegatedAgent } from './utils.js';

/** Returns a 404 Response if the repo is private and the caller lacks access. */
export function checkRepoAccess(c: Context<HonoEnv>, manifest: Manifest): Response | null {
  if (manifest.visibility !== 'private') return null;
  const addr = c.get('address');
  if (!addr) return c.json({ error: 'Repository not found.' }, 404) as unknown as Response;
  const lower = addr.toLowerCase();
  const hasAccess =
    manifest.acl.owners.some((a) => a.toLowerCase() === lower) ||
    manifest.acl.writers.some((a) => a.toLowerCase() === lower) ||
    isDelegatedAgent(addr, manifest);
  if (!hasAccess) return c.json({ error: 'Repository not found.' }, 404) as unknown as Response;
  return null;
}

// ---------------------------------------------------------------------------
// Platform admin guard — requires valid session + platform admin role
// ---------------------------------------------------------------------------

import { isAdmin } from './platform.js';

export const requireAdmin: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const token = header.slice(7);
  const address = await c.env.SESSIONS.get(`session:${token}`);
  if (!address) {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  if (!isAdmin(c.env, address)) {
    return c.json({ error: 'Platform admin access required.' }, 403);
  }

  c.set('address', address);
  await next();
};

// ---------------------------------------------------------------------------
// Alias validation
// ---------------------------------------------------------------------------

const ALIAS_RE = /^[a-zA-Z0-9_-]{1,32}$/;

/** Validate an alias string. Returns error message or null. */
export function validateAlias(alias: string): string | null {
  if (!alias) return 'Alias is required.';
  if (!ALIAS_RE.test(alias)) {
    return 'Alias must be 1-32 characters: letters, digits, hyphens, underscores.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body size limit — reject oversized payloads early
// ---------------------------------------------------------------------------

/** Max request body size in bytes (10 MB). */
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/** Max files allowed in a single commit. */
export const MAX_FILES_PER_COMMIT = 200;

export const maxBodySize: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const cl = c.req.header('Content-Length');
  if (cl && parseInt(cl, 10) > MAX_BODY_SIZE) {
    return c.json(
      { error: `Request body too large (max ${MAX_BODY_SIZE / 1024 / 1024} MB).` },
      413,
    );
  }
  await next();
};

// ---------------------------------------------------------------------------
// Rate limiting (lightweight, KV-based)
// ---------------------------------------------------------------------------

/** Max write requests per address per minute. */
const RATE_LIMIT = 30;

export const rateLimit: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const address = c.get('address');
  if (!address) {
    await next();
    return;
  }

  const minute = Math.floor(Date.now() / 60_000);
  const key = `rate:${address}:${minute}`;

  const current = parseInt((await c.env.SESSIONS.get(key)) ?? '0', 10);
  if (current >= RATE_LIMIT) {
    return c.json({ error: 'Rate limit exceeded. Try again in a minute.' }, 429);
  }

  // Increment (best-effort — not atomic, but good enough for rate limiting)
  await c.env.SESSIONS.put(key, String(current + 1), { expirationTtl: 120 });
  await next();
};
