// ---------------------------------------------------------------------------
// GitLike — Worker Operations (API Route Handlers)
// Input validation + dispatch to RepoLock DO for serialized mutations.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import type { HonoEnv } from './index.js';
import {
  requireAuth,
  rateLimit,
  optionalAuth,
  checkRepoAccess,
  MAX_FILES_PER_COMMIT,
} from './middleware.js';
import {
  createStorage,
  pinJSON,
  pinBlob,
  createPresignedUrl,
  fetchManifest,
  fetchJSON,
  fetchRaw,
  walkCommitHistory,
  storeManifestCid,
  storeCidSignature,
  getCidSignature,
} from './ipfs.js';
import { getLicenseText, LICENSE_OPTIONS, LICENSE_NAMES } from './licenses.js';
import type { LicenseId } from './licenses.js';
import type { GroupId, Address, Tree, Commit, Manifest } from './ipfs.js';
import type { StagedFile } from './tree-builder.js';
import type { MutationInput } from './mutations.js';
import {
  validateRepoName,
  validateBranchName,
  validateCommitMessage,
  validateFilePath,
  validateCid,
  validateAddress,
} from './validation.js';
import { canCreateRepo } from './platform.js';
import {
  getRepoIndex,
  addToIndex,
  removeFromIndex,
  updateIndexEntry,
  bootstrapIndex,
  slugify,
  getSlug,
  setSlug,
  deleteSlug,
  bootstrapSlugs,
} from './repo-index.js';

const repos = new Hono<HonoEnv>();

// ---------------------------------------------------------------------------
// DO dispatch helper
// ---------------------------------------------------------------------------

/** Send a mutation to the RepoLock DO for serialized execution. */
async function dispatchToDO(
  env: HonoEnv['Bindings'],
  groupId: string,
  mutation: MutationInput,
): Promise<Response> {
  const id = env.REPO_LOCK.idFromName(groupId);
  const stub = env.REPO_LOCK.get(id);
  return stub.fetch(
    new Request('https://repo-lock/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mutation),
    }),
  );
}

// ---------------------------------------------------------------------------
// GET /api/repos — list all repos (public, no auth)
// ---------------------------------------------------------------------------

repos.get('/', optionalAuth, async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);

  try {
    let index = await getRepoIndex(c.env);

    // Bootstrap from Pinata if index is empty (first run / migration)
    if (index.length === 0) {
      await bootstrapIndex(c.env);
      index = await getRepoIndex(c.env);
    }

    // Filter out private repos the caller cannot access
    const addr = c.get('address');
    const lower = addr?.toLowerCase() ?? '';
    const visible = index.filter((e) => {
      if (e.visibility !== 'private') return true;
      if (!lower) return false;
      return (
        e.owner.toLowerCase() === lower || (e.writers ?? []).some((w) => w.toLowerCase() === lower)
      );
    });

    const page = visible.slice(offset, offset + limit);
    const nextOffset = offset + limit < visible.length ? offset + limit : null;

    // Fetch full manifests for the page slice only
    const provider = createStorage(c.env);
    const repos = await Promise.all(
      page.map(async (e) => {
        const manifest = await fetchManifest(provider, c.env, e.groupId as GroupId);
        return { groupId: e.groupId as GroupId, groupName: e.name, manifest };
      }),
    );

    c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return c.json({ repos, nextOffset, total: visible.length });
  } catch (err) {
    return c.json({ error: `Failed to list repos: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/resolve/:slug — resolve a repo slug to its groupId
// ---------------------------------------------------------------------------

repos.get('/resolve/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();

  try {
    let groupId = await getSlug(c.env, slug);
    if (!groupId) {
      // One-time migration: populate slugs from index
      await bootstrapSlugs(c.env);
      groupId = await getSlug(c.env, slug);
    }
    if (!groupId) return c.json({ error: 'Repository not found.' }, 404);
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return c.json({ groupId });
  } catch (err) {
    return c.json({ error: `Failed to resolve slug: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id — get a single repo manifest (public)
// ---------------------------------------------------------------------------

repos.get('/:id/manifest', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return c.json({ groupId, manifest });
  } catch (err) {
    return c.json({ error: `Failed to fetch repo: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos — create a new repo (auth required)
// Repo creation is not serialized via DO since the group doesn't exist yet.
// ---------------------------------------------------------------------------

// GET /api/repos/licenses — list available license options
repos.get('/licenses', (c) => {
  const licenses = LICENSE_OPTIONS.map((id) => ({ id, name: LICENSE_NAMES[id] }));
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({ licenses });
});

repos.post('/', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;

  // Platform-level creation gate
  const allowed = await canCreateRepo(c.env, c.env.SESSIONS, address);
  if (!allowed) {
    return c.json({ error: 'Repo creation is restricted. Contact the platform admin.' }, 403);
  }
  const body = await c.req.json<{
    name: string;
    description?: string;
    visibility?: 'public' | 'private';
    license?: string;
  }>();

  const nameErr = validateRepoName(body.name);
  if (nameErr) return c.json({ error: nameErr }, 400);

  // Check slug uniqueness
  const slug = slugify(body.name);
  const existingSlug = await getSlug(c.env, slug);
  if (existingSlug) {
    return c.json({ error: `A repository with the name "${body.name}" already exists.` }, 409);
  }

  const licenseId = (body.license as LicenseId) || 'NOL';
  const licenseText = getLicenseText(licenseId, undefined, address);

  try {
    const provider = createStorage(c.env);

    const repoId = await provider.createRepo(body.name);
    const groupId = repoId;

    // Build initial tree — include LICENSE file if a license was chosen
    const treeEntries: Tree['entries'] = [];
    if (licenseText) {
      const licenseFile = new File([licenseText], 'LICENSE', { type: 'text/plain' });
      const licenseUpload = await pinBlob(provider, licenseFile, groupId, 'LICENSE');
      treeEntries.push({
        name: 'LICENSE',
        cid: licenseUpload.cid,
        kind: 'blob',
        size: licenseText.length,
      });
    }
    const tree: Tree = { type: 'tree', entries: treeEntries };
    const treeUpload = await pinJSON(provider, tree, groupId);

    const commit: Commit = {
      type: 'commit',
      tree: treeUpload.cid,
      parents: [],
      author: address,
      timestamp: new Date().toISOString(),
      message: 'Initial commit',
    };
    const commitUpload = await pinJSON(provider, commit, groupId, { branch: 'main' });

    const manifest: Manifest = {
      type: 'manifest',
      name: body.name,
      description: body.description ?? '',
      defaultBranch: 'main',
      branches: { main: commitUpload.cid },
      acl: { owners: [address], writers: [address], agents: {} },
      visibility: body.visibility === 'private' ? 'private' : 'public',
      license: licenseId !== 'none' ? licenseId : undefined,
      version: 1,
    };
    const manifestUpload = await pinJSON(provider, manifest, groupId);
    await storeManifestCid(provider, c.env, groupId, manifestUpload.cid);

    // Maintain KV repo index
    await addToIndex(c.env, {
      groupId,
      name: body.name,
      description: body.description ?? '',
      owner: address,
      writers: [address.toLowerCase()],
      visibility: body.visibility === 'private' ? 'private' : 'public',
      updatedAt: new Date().toISOString(),
    });

    // Register slug mapping
    await setSlug(c.env, slug, groupId);

    return c.json({ groupId, manifestCid: manifestUpload.cid, commitCid: commitUpload.cid }, 201);
  } catch (err) {
    return c.json({ error: `Failed to create repo: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/presign — get presigned upload URL (auth required)
// ---------------------------------------------------------------------------

repos.post('/:id/presign', requireAuth, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);

    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    if (!isOwnerOrWriter(address, manifest) && !isDelegatedAgent(address, manifest)) {
      return c.json({ error: 'Not authorized to upload to this repository.' }, 403);
    }

    const url = await createPresignedUrl(provider, groupId);
    return c.json({ url });
  } catch (err) {
    return c.json({ error: `Failed to create presigned URL: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/commit — create a commit (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/commit', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    branch: string;
    message: string;
    files: StagedFile[];
    signature?: string;
    expectedHead?: string;
  }>();

  // Validate inputs before dispatching to DO
  const branchErr = validateBranchName(body.branch);
  if (branchErr) return c.json({ error: branchErr }, 400);

  const msgErr = validateCommitMessage(body.message);
  if (msgErr) return c.json({ error: msgErr }, 400);

  if (body.files.length > MAX_FILES_PER_COMMIT) {
    return c.json({ error: `Too many files (max ${MAX_FILES_PER_COMMIT} per commit).` }, 400);
  }

  for (const f of body.files) {
    const pathErr = validateFilePath(f.path);
    if (pathErr) return c.json({ error: `${f.path}: ${pathErr}` }, 400);
    if (!f.deleted) {
      const cidErr = validateCid(f.cid);
      if (cidErr) return c.json({ error: `${f.path}: ${cidErr}` }, 400);
    }
  }

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'commit',
    groupId,
    address,
    branch: body.branch,
    message: body.message,
    files: body.files,
    signature: body.signature,
    expectedHead: body.expectedHead,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/branch — create a branch (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/branch', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{ name: string; from: string }>();

  const nameErr = validateBranchName(body.name);
  if (nameErr) return c.json({ error: nameErr }, 400);

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'branch',
    groupId,
    address,
    name: body.name,
    from: body.from,
  });

  return new Response(doRes.body, {
    status: doRes.ok ? 201 : doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/branch/:name — delete a branch (serialized via DO)
// ---------------------------------------------------------------------------

repos.delete('/:id/branch/:name', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const name = c.req.param('name');

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'deleteBranch',
    groupId,
    address,
    name,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/merge — merge branches (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/merge', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    source: string;
    target: string;
    message?: string;
    signature?: string;
  }>();

  const srcErr = validateBranchName(body.source);
  if (srcErr) return c.json({ error: `source: ${srcErr}` }, 400);

  const tgtErr = validateBranchName(body.target);
  if (tgtErr) return c.json({ error: `target: ${tgtErr}` }, 400);

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'merge',
    groupId,
    address,
    source: body.source,
    target: body.target,
    message: body.message,
    signature: body.signature,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/delegation — create delegation (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/delegation', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    agent: string;
    scope: { actions: string[]; paths: string[] };
    expiresInMs?: number;
    signature: string;
  }>();

  const agentErr = validateAddress(body.agent);
  if (agentErr) return c.json({ error: agentErr }, 400);

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'delegation',
    groupId,
    address,
    agent: body.agent,
    scope: body.scope,
    expiresInMs: body.expiresInMs,
    signature: body.signature,
  });

  return new Response(doRes.body, {
    status: doRes.ok ? 201 : doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/tag/:name — create a tag (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/tag/:name', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const name = c.req.param('name');
  const body = await c.req.json<{ target: string }>();

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'createTag',
    groupId,
    address,
    name,
    target: body.target,
  });

  return new Response(doRes.body, {
    status: doRes.ok ? 201 : doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/tag/:name — delete a tag (serialized via DO)
// ---------------------------------------------------------------------------

repos.delete('/:id/tag/:name', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const name = c.req.param('name');

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'deleteTag',
    groupId,
    address,
    name,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/fork — fork a repo (creates new group)
// ---------------------------------------------------------------------------

repos.post('/:id/fork', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const repoId = await provider.createRepo(`${manifest.name} (fork)`);
    const forkedManifest: typeof manifest = {
      ...manifest,
      acl: { owners: [address], writers: [address], agents: {} },
      forkedFrom: groupId,
      version: 1,
    };
    const upload = await pinJSON(provider, forkedManifest, repoId);
    await storeManifestCid(provider, c.env, repoId, upload.cid);

    // Maintain KV repo index for the fork
    await addToIndex(c.env, {
      groupId: repoId,
      name: `${manifest.name} (fork)`,
      description: manifest.description,
      owner: address,
      writers: [address.toLowerCase()],
      visibility: forkedManifest.visibility ?? 'public',
      updatedAt: new Date().toISOString(),
    });

    // Register slug mapping for forked repo
    const forkSlug = slugify(`${manifest.name} (fork)`);
    if (forkSlug) {
      const existing = await getSlug(c.env, forkSlug);
      if (!existing) await setSlug(c.env, forkSlug, repoId);
    }

    return c.json({ groupId: repoId, manifestCid: upload.cid }, 201);
  } catch (err) {
    return c.json({ error: `Failed to fork: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/delegation/:agent — revoke (serialized via DO)
// ---------------------------------------------------------------------------

repos.delete('/:id/delegation/:agent', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const agentAddr = c.req.param('agent');

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'revokeDelegation',
    groupId,
    address,
    agent: agentAddr,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/settings — update repo settings (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/settings', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    name?: string;
    description?: string;
    writers?: string[];
    protectedBranches?: string[];
    visibility?: 'public' | 'private';
    encryption?: {
      enabled: boolean;
      algorithm: 'AES-256-GCM';
      currentEpoch: number;
      encryptTreeNames?: boolean;
    };
    keyBundle?: Record<
      number,
      {
        ownerPublicKey: string;
        wrappedKeys: Record<string, string>;
        signature?: string;
        createdAt: string;
      }
    >;
  }>();

  // Validate encryption fields if present
  if (body.encryption || body.keyBundle) {
    const { validateEncryptionFields } = await import('./validation.js');
    const encErr = validateEncryptionFields(
      body.encryption as Parameters<typeof validateEncryptionFields>[0],
      body.keyBundle as unknown as Record<string, unknown>,
    );
    if (encErr) return c.json({ error: encErr }, 400);
  }

  // Capture old slug BEFORE dispatching to DO (which mutates the manifest)
  let oldSlugBeforeRename: string | undefined;
  if (body.name) {
    const provider = createStorage(c.env);
    const oldManifest = await fetchManifest(provider, c.env, groupId);
    if (oldManifest) oldSlugBeforeRename = slugify(oldManifest.name);
  }

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'updateSettings',
    groupId,
    address,
    name: body.name,
    description: body.description,
    writers: body.writers,
    protectedBranches: body.protectedBranches,
    visibility: body.visibility,
    encryption: body.encryption,
    keyBundle: body.keyBundle,
  });

  // Update KV repo index if settings changed successfully
  if (doRes.ok) {
    const patch: Record<string, string | string[]> = {};
    if (body.name) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.visibility) patch.visibility = body.visibility;
    if (body.writers) patch.writers = body.writers.map((w) => w.toLowerCase());
    if (Object.keys(patch).length > 0) {
      await updateIndexEntry(c.env, groupId, patch);
    }

    // Update slug mapping on rename
    if (body.name && oldSlugBeforeRename) {
      const newSlug = slugify(body.name);
      if (oldSlugBeforeRename !== newSlug) {
        await deleteSlug(c.env, oldSlugBeforeRename);
        await setSlug(c.env, newSlug, groupId);
      }
    }
  }

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/pages — toggle GitLike Pages (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/pages', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    enabled: boolean;
    slug?: string;
    branch?: string;
    folder?: string;
  }>();

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'togglePages',
    groupId,
    address,
    enabled: !!body.enabled,
    slug: body.slug,
    branch: body.branch,
    folder: body.folder,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id — delete a repo (owner only)
// ---------------------------------------------------------------------------

repos.delete('/:id', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const lower = address.toLowerCase();
    if (!manifest.acl.owners.some((a) => a.toLowerCase() === lower)) {
      return c.json({ error: 'Only owners can delete repositories.' }, 403);
    }

    await provider.deleteRepo(groupId);
    await c.env.SESSIONS.delete(`manifest:${groupId}`);
    await removeFromIndex(c.env, groupId);

    // Remove slug mapping
    const slug = slugify(manifest.name);
    if (slug) await deleteSlug(c.env, slug);

    return c.json({ deleted: true });
  } catch (err) {
    return c.json({ error: `Failed to delete repo: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/pr — create a pull request (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/pr', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    title: string;
    description?: string;
    sourceBranch: string;
    targetBranch: string;
  }>();

  if (!body.title?.trim()) return c.json({ error: 'Title is required.' }, 400);

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'createPR',
    groupId,
    address,
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    sourceBranch: body.sourceBranch,
    targetBranch: body.targetBranch,
  });

  return new Response(doRes.body, {
    status: doRes.ok ? 201 : doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/repos/:id/pr/:cid — update PR status (serialized via DO)
// ---------------------------------------------------------------------------

repos.patch('/:id/pr/:cid', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const prCid = c.req.param('cid');
  const body = await c.req.json<{ status: 'open' | 'merged' | 'closed' }>();

  if (!['open', 'merged', 'closed'].includes(body.status)) {
    return c.json({ error: 'Invalid status.' }, 400);
  }

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'updatePR',
    groupId,
    address,
    prCid,
    status: body.status,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/prs — list pull requests (public)
// ---------------------------------------------------------------------------

repos.get('/:id/prs', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const prCids = manifest.pullRequests ?? [];
    const settled = await Promise.allSettled(
      prCids.map(async (cid) => {
        const pr = await fetchJSON(c.env, cid);
        return { cid, pr };
      }),
    );
    const prs = settled
      .filter(
        (r): r is PromiseFulfilledResult<{ cid: string; pr: unknown }> => r.status === 'fulfilled',
      )
      .map((r) => r.value);

    c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return c.json({ prs });
  } catch (err) {
    return c.json({ error: `Failed to list PRs: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/issues — create an issue (serialized via DO)
// ---------------------------------------------------------------------------

repos.post('/:id/issues', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;

  const body = await c.req.json<{
    title: string;
    body?: string;
    labels?: string[];
  }>();

  if (!body.title?.trim()) return c.json({ error: 'Title is required.' }, 400);

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'createIssue',
    groupId,
    address,
    title: body.title.trim(),
    body: body.body?.trim() ?? '',
    labels: body.labels ?? [],
  });

  return new Response(doRes.body, {
    status: doRes.ok ? 201 : doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/repos/:id/issues/:cid — update an issue (serialized via DO)
// ---------------------------------------------------------------------------

repos.patch('/:id/issues/:cid', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const groupId = c.req.param('id') as GroupId;
  const issueCid = c.req.param('cid');

  const body = await c.req.json<{
    status?: 'open' | 'closed';
    comment?: string;
    labels?: string[];
  }>();

  if (body.status && !['open', 'closed'].includes(body.status)) {
    return c.json({ error: 'Invalid status.' }, 400);
  }

  const doRes = await dispatchToDO(c.env, groupId, {
    action: 'updateIssue',
    groupId,
    address,
    issueCid,
    status: body.status,
    comment: body.comment?.trim(),
    labels: body.labels,
  });

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/issues — list issues (public)
// ---------------------------------------------------------------------------

repos.get('/:id/issues', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const issueCids = manifest.issues ?? [];
    const settled = await Promise.allSettled(
      issueCids.map(async (cid) => {
        const issue = await fetchJSON(c.env, cid);
        return { cid, issue };
      }),
    );
    const issues = settled
      .filter(
        (r): r is PromiseFulfilledResult<{ cid: string; issue: unknown }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);

    c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return c.json({ issues });
  } catch (err) {
    return c.json({ error: `Failed to list issues: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/commits/:branch — paginated commit history (public)
// ---------------------------------------------------------------------------

repos.get('/:id/commits/:branch', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;
  const branch = c.req.param('branch');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const after = c.req.query('after') ?? null;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const headCid = manifest.branches[branch];
    if (!headCid) return c.json({ error: `Branch "${branch}" not found.` }, 404);

    const startCid = after ?? headCid;
    const entries = await walkCommitHistory(c.env, startCid, limit + 1);

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const nextCursor =
      hasMore && page.length > 0 ? (page[page.length - 1].commit.parents[0] ?? null) : null;

    // Return flat commit objects for backwards compatibility
    c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return c.json({ commits: page.map((e) => e.commit), nextCursor });
  } catch (err) {
    return c.json({ error: `Failed to fetch commits: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/archive/:branch — download repo as ZIP (public)
// ---------------------------------------------------------------------------

repos.get('/:id/archive/:branch', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;
  const branch = c.req.param('branch');

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const commitCid = manifest.branches[branch];
    if (!commitCid) return c.json({ error: `Branch "${branch}" not found.` }, 404);

    const commit = await fetchJSON<{ tree: string }>(c.env, commitCid);
    const tree = await fetchJSON<Tree>(c.env, commit.tree);

    // Collect all files recursively (cap at 500 files / 50MB / 25s)
    const MAX_FILES = 500;
    const MAX_BYTES = 50 * 1024 * 1024;
    const ARCHIVE_TIMEOUT_MS = 25_000;
    const archiveAbort = AbortSignal.timeout(ARCHIVE_TIMEOUT_MS);
    const files: Record<string, Uint8Array> = {};
    let totalBytes = 0;
    let fileCount = 0;

    async function walkTree(t: Tree, prefix: string): Promise<void> {
      for (const entry of t.entries) {
        if (archiveAbort.aborted || fileCount >= MAX_FILES || totalBytes >= MAX_BYTES) return;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'blob') {
          try {
            const data = await fetchRaw(c.env, entry.cid);
            files[path] = data;
            totalBytes += data.byteLength;
            fileCount++;
          } catch {
            files[path] = new TextEncoder().encode(`[fetch failed: ${entry.cid}]`);
            fileCount++;
          }
        } else {
          const sub = await fetchJSON<Tree>(c.env, entry.cid);
          await walkTree(sub, path);
        }
      }
    }

    await walkTree(tree, '');

    if (archiveAbort.aborted) {
      return c.json({ error: 'Archive timed out — repository too large.' }, 503);
    }

    const { zipSync } = await import('fflate');
    const zipped = zipSync(files, { level: 6 });
    const repoName = manifest.name || 'repo';

    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${repoName}-${branch}.zip"`,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return c.json({ error: `Archive failed: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/feed — Atom feed of recent commits (public)
// ---------------------------------------------------------------------------

repos.get('/:id/feed', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const branch = manifest.defaultBranch;
    const headCid = manifest.branches[branch];
    if (!headCid) return c.json({ error: 'No commits.' }, 404);

    const entries = await walkCommitHistory(c.env, headCid, 20);
    const repoName = manifest.name || groupId;
    const baseUrl = c.env.ALLOWED_ORIGIN || 'https://gitlike.dev';
    const feedUrl = `${baseUrl}/api/repos/${groupId}/feed`;
    const repoUrl = `${baseUrl}/${groupId}`;

    let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
    xml += `<feed xmlns="http://www.w3.org/2005/Atom">\n`;
    xml += `  <title>${esc(repoName)} — Commits</title>\n`;
    xml += `  <link href="${repoUrl}" rel="alternate" />\n`;
    xml += `  <link href="${feedUrl}" rel="self" type="application/atom+xml" />\n`;
    xml += `  <id>urn:gitlike:${groupId}</id>\n`;
    xml += `  <updated>${entries[0]?.commit.timestamp ?? new Date().toISOString()}</updated>\n`;

    for (const { cid, commit } of entries) {
      xml += `  <entry>\n`;
      xml += `    <title>${esc(commit.message)}</title>\n`;
      xml += `    <link href="${repoUrl}/commits" rel="alternate" />\n`;
      xml += `    <author><name>${esc(commit.author)}</name></author>\n`;
      xml += `    <updated>${commit.timestamp}</updated>\n`;
      xml += `    <id>urn:gitlike:${groupId}:${cid}</id>\n`;
      xml += `    <summary>${esc(commit.author)} committed: ${esc(commit.message)}</summary>\n`;
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
    return c.json({ error: `Feed failed: ${errorMsg(err)}` }, 500);
  }
});

/** Escape XML special characters. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// GET /api/repos/:id/search — code search (public)
// ---------------------------------------------------------------------------

repos.get('/:id/search', optionalAuth, async (c) => {
  const groupId = c.req.param('id') as GroupId;
  const q = c.req.query('q')?.trim();
  const branch = c.req.query('branch') ?? 'main';

  if (!q || q.length < 2) return c.json({ error: 'Query must be at least 2 characters.' }, 400);

  try {
    const provider = createStorage(c.env);
    const manifest = await fetchManifest(provider, c.env, groupId);
    if (!manifest) return c.json({ error: 'Repository not found.' }, 404);

    const denied = checkRepoAccess(c, manifest);
    if (denied) return denied;

    const headCid = manifest.branches[branch];
    if (!headCid) return c.json({ error: `Branch "${branch}" not found.` }, 404);

    const commit = await fetchJSON<{ tree: string }>(c.env, headCid);
    const rootTree = await fetchJSON<Tree>(c.env, commit.tree);

    type SearchResult = { path: string; matches: Array<{ line: number; text: string }> };
    const results: SearchResult[] = [];
    const MAX_RESULTS = 50;
    const MAX_FILES = 200;
    let searched = 0;

    const lower = q.toLowerCase();

    async function searchTree(tree: Tree, prefix: string): Promise<void> {
      for (const entry of tree.entries) {
        if (results.length >= MAX_RESULTS || searched >= MAX_FILES) return;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'tree') {
          const sub = await fetchJSON<Tree>(c.env, entry.cid);
          await searchTree(sub, path);
        } else {
          // Skip likely binary files
          const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
          if (
            [
              'png',
              'jpg',
              'gif',
              'zip',
              'gz',
              'wasm',
              'pdf',
              'exe',
              'dll',
              'woff',
              'woff2',
              'mp4',
              'mp3',
            ].includes(ext)
          )
            continue;
          searched++;
          try {
            const raw = await fetchRaw(c.env, entry.cid);
            // Quick binary check
            if (raw.byteLength > 0 && raw.some((b, i) => i < 512 && b === 0)) continue;
            const text = new TextDecoder().decode(raw);
            const lines = text.split('\n');
            const matches: Array<{ line: number; text: string }> = [];
            for (let i = 0; i < lines.length && matches.length < 5; i++) {
              if (lines[i].toLowerCase().includes(lower)) {
                matches.push({ line: i + 1, text: lines[i].slice(0, 200) });
              }
            }
            if (matches.length > 0) results.push({ path, matches });
          } catch {
            /* skip */
          }
        }
      }
    }

    await searchTree(rootTree, '');
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ results, total: results.length });
  } catch (err) {
    return c.json({ error: `Search failed: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/signature/:cid — fetch Pinata signature for a CID
// ---------------------------------------------------------------------------

repos.get('/:id/signature/:cid', async (c) => {
  const cid = c.req.param('cid');

  try {
    const result = await getCidSignature(c.env, cid);
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    return c.json(result);
  } catch {
    return c.json({ cid, signature: null }, 200);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/signature/:cid — register a signature for a CID
// ---------------------------------------------------------------------------

repos.post('/:id/signature/:cid', requireAuth, rateLimit, async (c) => {
  const address = c.get('address') as Address;
  const cid = c.req.param('cid');
  const body = await c.req.json<{ signature: string }>();

  if (!body.signature) return c.json({ error: 'Signature is required.' }, 400);

  try {
    await storeCidSignature(c.env, cid, body.signature as `0x${string}`, address);
    return c.json({ ok: true, cid });
  } catch (err) {
    return c.json({ error: `Failed to register signature: ${errorMsg(err)}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// Shared helpers (re-exported from utils.ts)
// ---------------------------------------------------------------------------

import { isOwnerOrWriter, isDelegatedAgent, errorMsg } from './utils.js';

export { repos as repoRoutes };
