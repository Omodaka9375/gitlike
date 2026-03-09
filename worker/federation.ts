// ---------------------------------------------------------------------------
// GitLike — Federation Registry
// Peer discovery, registration, and periodic sync for federated instances.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import type { HonoEnv } from './index.js';
import type { Env } from './env.js';
import { requireAdmin } from './middleware.js';
import { getRepoIndex } from './repo-index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** KV key for the peer registry. */
const PEERS_KEY = 'federation:peers';

/** Max peers an instance can register. */
const MAX_PEERS = 50;

/** Timeout for outbound discovery/sync fetches (ms). */
const SYNC_TIMEOUT = 8_000;

/** Max repos to store per peer. */
const MAX_PEER_REPOS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary of a repo on a federated peer. */
export type FederatedRepo = {
  name: string;
  description: string;
  owner: string;
  domain: string;
  updatedAt: string;
};

/** Registered federated peer instance. */
export type FederatedPeer = {
  domain: string;
  name: string;
  version: string;
  repoCount: number;
  status: 'online' | 'offline' | 'pending';
  registeredAt: string;
  lastSyncAt: string | null;
  repos: FederatedRepo[];
};

/** Shape of a remote /.well-known/gitlike.json response. */
type WellKnownResponse = {
  name?: string;
  domain?: string;
  version?: string;
  federation?: boolean;
  repoCount?: number;
  publicRepos?: Array<{ name: string; description: string; owner: string; updatedAt: string }>;
};

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

/** Read the peer registry from KV. */
export async function getPeers(kv: KVNamespace): Promise<FederatedPeer[]> {
  const raw = await kv.get(PEERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as FederatedPeer[];
  } catch {
    return [];
  }
}

/** Write the peer registry to KV. */
async function putPeers(kv: KVNamespace, peers: FederatedPeer[]): Promise<void> {
  await kv.put(PEERS_KEY, JSON.stringify(peers));
}

// ---------------------------------------------------------------------------
// Discovery — fetch and validate a remote instance
// ---------------------------------------------------------------------------

/** Fetch /.well-known/gitlike.json from a domain. Returns null on failure. */
async function discoverInstance(domain: string): Promise<WellKnownResponse | null> {
  try {
    const url = `https://${domain}/.well-known/gitlike.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(SYNC_TIMEOUT) });
    if (!res.ok) return null;
    const data = (await res.json()) as WellKnownResponse;
    if (!data.federation) return null;
    return data;
  } catch {
    return null;
  }
}

/** Fetch public repos from a remote instance's API. */
async function fetchRemoteRepos(
  domain: string,
): Promise<Array<{ name: string; description: string; owner: string; updatedAt: string }>> {
  try {
    const url = `https://${domain}/api/repos?limit=${MAX_PEER_REPOS}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(SYNC_TIMEOUT) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      repos: Array<{
        groupId: string;
        groupName: string;
        manifest: {
          name: string;
          description: string;
          acl: { owners: string[] };
          visibility?: string;
        } | null;
      }>;
    };
    return data.repos
      .filter((r) => r.manifest && r.manifest.visibility !== 'private')
      .map((r) => ({
        name: r.manifest!.name,
        description: r.manifest!.description || '',
        owner: r.manifest!.acl.owners[0] ?? '',
        updatedAt: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sync — refresh all registered peers
// ---------------------------------------------------------------------------

/** Sync all registered peers. Updates status, repo lists, and metadata. */
export async function syncAllPeers(kv: KVNamespace): Promise<number> {
  const peers = await getPeers(kv);
  if (peers.length === 0) return 0;

  let synced = 0;
  const now = new Date().toISOString();

  for (const peer of peers) {
    const info = await discoverInstance(peer.domain);
    if (!info) {
      peer.status = 'offline';
      peer.lastSyncAt = now;
      continue;
    }

    peer.name = info.name || peer.name;
    peer.version = info.version || peer.version;
    peer.status = 'online';
    peer.lastSyncAt = now;

    // Use publicRepos from well-known if available, otherwise fetch API
    if (info.publicRepos && info.publicRepos.length > 0) {
      peer.repos = info.publicRepos.slice(0, MAX_PEER_REPOS).map((r) => ({
        ...r,
        domain: peer.domain,
      }));
      peer.repoCount = info.repoCount ?? info.publicRepos.length;
    } else {
      const repos = await fetchRemoteRepos(peer.domain);
      peer.repos = repos.slice(0, MAX_PEER_REPOS).map((r) => ({ ...r, domain: peer.domain }));
      peer.repoCount = info.repoCount ?? repos.length;
    }
    synced++;
  }

  await putPeers(kv, peers);
  return synced;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const federationRoutes = new Hono<HonoEnv>();

/** List all federated peers (public). */
federationRoutes.get('/peers', async (c) => {
  const peers = await getPeers(c.env.SESSIONS);
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return c.json({ peers });
});

/** Register a new peer instance (admin only). */
federationRoutes.post('/register', requireAdmin, async (c) => {
  const body = await c.req.json<{ domain: string }>();
  const domain = body.domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (!domain || domain.length > 253) {
    return c.json({ error: 'Invalid domain.' }, 400);
  }

  // Block registering self
  const selfDomain = new URL(c.env.ALLOWED_ORIGIN || 'https://gitlike.dev').hostname;
  if (domain === selfDomain) {
    return c.json({ error: 'Cannot register your own instance as a peer.' }, 400);
  }

  const peers = await getPeers(c.env.SESSIONS);

  // Check duplicate
  if (peers.some((p) => p.domain === domain)) {
    return c.json({ error: 'Peer already registered.' }, 409);
  }

  if (peers.length >= MAX_PEERS) {
    return c.json({ error: `Maximum of ${MAX_PEERS} peers reached.` }, 400);
  }

  // Discover the remote instance
  const info = await discoverInstance(domain);
  if (!info) {
    return c.json(
      {
        error:
          'Could not reach instance or federation is disabled. Ensure /.well-known/gitlike.json is accessible and returns federation: true.',
      },
      422,
    );
  }

  const now = new Date().toISOString();
  const peer: FederatedPeer = {
    domain,
    name: info.name || domain,
    version: info.version || 'unknown',
    repoCount: info.repoCount ?? 0,
    status: 'online',
    registeredAt: now,
    lastSyncAt: now,
    repos: [],
  };

  // Fetch initial repos
  if (info.publicRepos && info.publicRepos.length > 0) {
    peer.repos = info.publicRepos.slice(0, MAX_PEER_REPOS).map((r) => ({ ...r, domain }));
    peer.repoCount = info.repoCount ?? info.publicRepos.length;
  } else {
    const repos = await fetchRemoteRepos(domain);
    peer.repos = repos.slice(0, MAX_PEER_REPOS).map((r) => ({ ...r, domain }));
    peer.repoCount = info.repoCount ?? repos.length;
  }

  peers.push(peer);
  await putPeers(c.env.SESSIONS, peers);

  return c.json({ peer }, 201);
});

/** Remove a peer (admin only). */
federationRoutes.delete('/peers/:domain', requireAdmin, async (c) => {
  const domain = c.req.param('domain').toLowerCase();
  const peers = await getPeers(c.env.SESSIONS);
  const filtered = peers.filter((p) => p.domain !== domain);

  if (filtered.length === peers.length) {
    return c.json({ error: 'Peer not found.' }, 404);
  }

  await putPeers(c.env.SESSIONS, filtered);
  return c.json({ ok: true });
});

/** Manually trigger sync (admin only). */
federationRoutes.post('/sync', requireAdmin, async (c) => {
  const synced = await syncAllPeers(c.env.SESSIONS);
  return c.json({ ok: true, synced });
});

// ---------------------------------------------------------------------------
// Well-known payload builder
// ---------------------------------------------------------------------------

/** Build the enhanced /.well-known/gitlike.json payload. */
export async function buildWellKnownPayload(
  env: Env,
  platformName: string,
): Promise<Record<string, unknown>> {
  const repoIndex = await getRepoIndex(env);
  const publicRepos = repoIndex
    .filter((r) => r.visibility !== 'private')
    .slice(0, MAX_PEER_REPOS)
    .map((r) => ({
      name: r.name,
      description: r.description,
      owner: r.owner,
      updatedAt: r.updatedAt,
    }));

  return {
    name: platformName || 'GitLike',
    domain: new URL(env.ALLOWED_ORIGIN || 'https://gitlike.dev').hostname,
    version: '0.1.0',
    federation: true,
    repoCount: repoIndex.filter((r) => r.visibility !== 'private').length,
    publicRepos,
  };
}
