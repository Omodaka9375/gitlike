// ---------------------------------------------------------------------------
// GitLike — Mutation Logic
// Pure mutation functions called by the RepoLock DO for serialized execution.
// ---------------------------------------------------------------------------

import {
  createStorage,
  pinJSON,
  fetchManifest,
  fetchJSON,
  storeCidSignature,
  storeManifestCid,
  pruneOldSnapshots,
} from './ipfs.js';
import type { Address, GroupId, Tree, Commit, Manifest, PullRequest, Issue } from './ipfs.js';
import { buildMergedTree, mergeTrees } from './tree-builder.js';
import type { StagedFile } from './tree-builder.js';
import type { Env } from './env.js';
import { getPlatformSettings } from './platform.js';
import { verifyTypedData } from 'viem';

// ---------------------------------------------------------------------------
// Commit mutation
// ---------------------------------------------------------------------------

export type CommitInput = {
  action: 'commit';
  groupId: GroupId;
  address: Address;
  branch: string;
  message: string;
  files: StagedFile[];
  signature?: string;
  /** If provided, reject if branch HEAD doesn't match (stale-push guard). */
  expectedHead?: string;
};

export type CommitResult = {
  commitCid: string;
  treeCid: string;
  manifestCid: string;
};

/** Execute a commit — must be called within a serialized context (DO). */
export async function executeCommit(env: Env, input: CommitInput): Promise<CommitResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository manifest not found.', 404);

  const filePaths = input.files.map((f) => f.path);
  if (
    !isOwnerOrWriter(input.address, manifest) &&
    !isDelegatedAgent(input.address, manifest, 'commit', filePaths)
  ) {
    throw new MutationError('Not authorized to write to this repository.', 403);
  }

  // Branch protection: only owners can push to protected branches
  if (manifest.protectedBranches?.includes(input.branch) && !isOwner(input.address, manifest)) {
    throw new MutationError(`Branch "${input.branch}" is protected. Only owners can push.`, 403);
  }

  const parentCid = manifest.branches[input.branch];
  if (!parentCid) throw new MutationError(`Branch "${input.branch}" not found.`, 404);

  // Stale-push guard: reject if caller expected a different HEAD
  if (input.expectedHead && input.expectedHead !== parentCid) {
    throw new MutationError('Remote HEAD has advanced. Pull before pushing.', 409);
  }

  const parentCommit = await fetchJSON<Commit>(env, parentCid);
  const parentTree = await fetchJSON<Tree>(env, parentCommit.tree);

  const treeCid = await buildMergedTree(provider, env, input.groupId, parentTree, input.files);

  // Attach delegation CID if committer is a delegated agent
  const delegationCid = !isOwnerOrWriter(input.address, manifest)
    ? findDelegationCid(input.address, manifest)
    : undefined;

  const commit: Commit = {
    type: 'commit',
    tree: treeCid,
    parents: [parentCid],
    author: input.address,
    timestamp: new Date().toISOString(),
    message: input.message,
    ...(delegationCid ? { delegation: delegationCid } : {}),
  };
  const commitUpload = await pinJSON(provider, commit, input.groupId, { branch: input.branch });

  if (input.signature) {
    try {
      await storeCidSignature(
        env,
        commitUpload.cid,
        input.signature as `0x${string}`,
        input.address,
      );
    } catch {
      // Signature registration is best-effort
    }
  }

  const updated: Manifest = {
    ...manifest,
    branches: { ...manifest.branches, [input.branch]: commitUpload.cid },
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  // Prune old snapshots beyond retention depth (fire-and-forget)
  getPlatformSettings(env.SESSIONS)
    .then((s) => {
      if (s.retentionDepth > 0) {
        return pruneOldSnapshots(provider, env, commitUpload.cid, s.retentionDepth);
      }
    })
    .catch(() => {});

  await recordActivity(env, input.address);

  return {
    commitCid: commitUpload.cid,
    treeCid,
    manifestCid: manifestUpload.cid,
  };
}

// ---------------------------------------------------------------------------
// Branch mutation
// ---------------------------------------------------------------------------

export type BranchInput = {
  action: 'branch';
  groupId: GroupId;
  address: Address;
  name: string;
  from: string;
};

export type BranchResult = {
  manifestCid: string;
};

/** Execute a branch creation — must be called within a serialized context (DO). */
export async function executeBranch(env: Env, input: BranchInput): Promise<BranchResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (
    !isOwnerOrWriter(input.address, manifest) &&
    !isDelegatedAgent(input.address, manifest, 'branch')
  ) {
    throw new MutationError('Not authorized.', 403);
  }

  const fromCid = manifest.branches[input.from];
  if (!fromCid) throw new MutationError(`Source branch "${input.from}" not found.`, 404);

  if (manifest.branches[input.name]) {
    throw new MutationError(`Branch "${input.name}" already exists.`, 409);
  }

  const updated: Manifest = {
    ...manifest,
    branches: { ...manifest.branches, [input.name]: fromCid },
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

// ---------------------------------------------------------------------------
// Merge mutation
// ---------------------------------------------------------------------------

export type MergeInput = {
  action: 'merge';
  groupId: GroupId;
  address: Address;
  source: string;
  target: string;
  message?: string;
  signature?: string;
};

export type MergeResult = {
  commitCid: string;
  treeCid: string;
  manifestCid: string;
  /** Files modified in both branches (potential conflicts). */
  conflicts?: string[];
};

/** Execute a branch merge — must be called within a serialized context (DO). */
export async function executeMerge(env: Env, input: MergeInput): Promise<MergeResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (
    !isOwnerOrWriter(input.address, manifest) &&
    !isDelegatedAgent(input.address, manifest, 'merge')
  ) {
    throw new MutationError('Not authorized.', 403);
  }

  // Branch protection: only owners can merge into protected branches
  if (manifest.protectedBranches?.includes(input.target) && !isOwner(input.address, manifest)) {
    throw new MutationError(`Branch "${input.target}" is protected. Only owners can merge.`, 403);
  }

  const targetCid = manifest.branches[input.target];
  if (!targetCid) throw new MutationError(`Target branch "${input.target}" not found.`, 404);

  const sourceCid = manifest.branches[input.source];
  if (!sourceCid) throw new MutationError(`Source branch "${input.source}" not found.`, 404);

  if (targetCid === sourceCid) {
    throw new MutationError('Branches are already up to date (same HEAD).', 409);
  }

  const targetCommit = await fetchJSON<Commit>(env, targetCid);
  const sourceCommit = await fetchJSON<Commit>(env, sourceCid);
  const targetTree = await fetchJSON<Tree>(env, targetCommit.tree);
  const sourceTree = await fetchJSON<Tree>(env, sourceCommit.tree);

  // Detect conflicts: files modified in both branches relative to common ancestor
  const conflicts = detectConflicts(targetTree, sourceTree);

  const treeCid = await mergeTrees(provider, env, input.groupId, targetTree, sourceTree);

  const msg = input.message || `Merge ${input.source} into ${input.target}`;
  const commit: Commit = {
    type: 'commit',
    tree: treeCid,
    parents: [targetCid, sourceCid],
    author: input.address,
    timestamp: new Date().toISOString(),
    message: msg,
  };
  const commitUpload = await pinJSON(provider, commit, input.groupId, { branch: input.target });

  if (input.signature) {
    try {
      await storeCidSignature(
        env,
        commitUpload.cid,
        input.signature as `0x${string}`,
        input.address,
      );
    } catch {
      // Best-effort
    }
  }

  const updated: Manifest = {
    ...manifest,
    branches: { ...manifest.branches, [input.target]: commitUpload.cid },
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  // Prune old snapshots beyond retention depth (fire-and-forget)
  getPlatformSettings(env.SESSIONS)
    .then((s) => {
      if (s.retentionDepth > 0) {
        return pruneOldSnapshots(provider, env, commitUpload.cid, s.retentionDepth);
      }
    })
    .catch(() => {});

  await recordActivity(env, input.address);

  return {
    commitCid: commitUpload.cid,
    treeCid,
    manifestCid: manifestUpload.cid,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}

/** Detect files that exist in both trees with different CIDs (potential conflicts). */
function detectConflicts(treeA: Tree, treeB: Tree, prefix = ''): string[] {
  const conflicts: string[] = [];
  const mapA = new Map(treeA.entries.map((e) => [e.name, e]));
  const mapB = new Map(treeB.entries.map((e) => [e.name, e]));

  for (const [name, entryA] of mapA) {
    const entryB = mapB.get(name);
    if (!entryB) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entryA.kind === 'blob' && entryB.kind === 'blob' && entryA.cid !== entryB.cid) {
      conflicts.push(path);
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Delete branch mutation
// ---------------------------------------------------------------------------

export type DeleteBranchInput = {
  action: 'deleteBranch';
  groupId: GroupId;
  address: Address;
  name: string;
};

export type DeleteBranchResult = {
  manifestCid: string;
};

/** Delete a branch — must be called within a serialized context (DO). */
export async function executeDeleteBranch(
  env: Env,
  input: DeleteBranchInput,
): Promise<DeleteBranchResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwnerOrWriter(input.address, manifest)) {
    throw new MutationError('Not authorized.', 403);
  }

  if (!manifest.branches[input.name]) {
    throw new MutationError(`Branch "${input.name}" not found.`, 404);
  }

  if (input.name === manifest.defaultBranch) {
    throw new MutationError('Cannot delete the default branch.', 400);
  }

  const { [input.name]: _, ...remaining } = manifest.branches;
  const updated: Manifest = {
    ...manifest,
    branches: remaining,
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

// ---------------------------------------------------------------------------
// Delegation mutation
// ---------------------------------------------------------------------------

export type DelegationInput = {
  action: 'delegation';
  groupId: GroupId;
  address: Address;
  agent: string;
  scope: { actions: string[]; paths: string[] };
  expiresInMs?: number;
  signature: string;
};

export type DelegationResult = {
  delegationCid: string;
  manifestCid: string;
};

/** EIP-712 domain for delegation signature verification. */
const DELEGATION_DOMAIN = {
  name: 'GitLike',
  version: '1',
  chainId: 1,
} as const;

/** EIP-712 type definition for delegation signatures. */
const DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegator', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'repo', type: 'string' },
    { name: 'actions', type: 'string' },
    { name: 'paths', type: 'string' },
    { name: 'expires', type: 'string' },
  ],
} as const;

/** Execute a delegation creation — must be called within a serialized context (DO). */
export async function executeDelegation(
  env: Env,
  input: DelegationInput,
): Promise<DelegationResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwner(input.address, manifest)) {
    throw new MutationError('Only owners can create delegations.', 403);
  }

  const expires = new Date(Date.now() + (input.expiresInMs ?? 86_400_000)).toISOString();

  // Verify EIP-712 delegation signature before storing
  const valid = await verifyTypedData({
    address: input.address as `0x${string}`,
    domain: DELEGATION_DOMAIN,
    types: DELEGATION_TYPES,
    primaryType: 'Delegation',
    message: {
      delegator: input.address,
      agent: input.agent as `0x${string}`,
      repo: input.groupId,
      actions: input.scope.actions.join(','),
      paths: input.scope.paths.join(','),
      expires,
    },
    signature: input.signature as `0x${string}`,
  });
  if (!valid) {
    throw new MutationError('Invalid delegation signature.', 403);
  }

  const delegation = {
    type: 'delegation' as const,
    delegator: input.address,
    agent: input.agent as Address,
    repo: input.groupId,
    scope: input.scope,
    expires,
    signature: input.signature as `0x${string}`,
  };

  const delegationUpload = await pinJSON(provider, delegation, input.groupId);

  const currentAgents = manifest.acl.agents[input.address] ?? [];
  const filtered = currentAgents.filter((e) => e.key.toLowerCase() !== input.agent.toLowerCase());
  filtered.push({
    key: input.agent as Address,
    scope: input.scope,
    expires,
    delegationCid: delegationUpload.cid,
  });

  const updated: Manifest = {
    ...manifest,
    acl: {
      ...manifest.acl,
      agents: { ...manifest.acl.agents, [input.address]: filtered },
    },
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  return {
    delegationCid: delegationUpload.cid,
    manifestCid: manifestUpload.cid,
  };
}

// ---------------------------------------------------------------------------
// Revoke delegation mutation
// ---------------------------------------------------------------------------

export type RevokeDelegationInput = {
  action: 'revokeDelegation';
  groupId: GroupId;
  address: Address;
  agent: string;
};

export type RevokeDelegationResult = {
  manifestCid: string;
};

/** Execute a delegation revocation — must be called within a serialized context (DO). */
export async function executeRevokeDelegation(
  env: Env,
  input: RevokeDelegationInput,
): Promise<RevokeDelegationResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwner(input.address, manifest)) {
    throw new MutationError('Only owners can revoke delegations.', 403);
  }

  const currentAgents = manifest.acl.agents[input.address] ?? [];
  const filtered = currentAgents.filter((e) => e.key.toLowerCase() !== input.agent.toLowerCase());

  const updated: Manifest = {
    ...manifest,
    acl: {
      ...manifest.acl,
      agents: { ...manifest.acl.agents, [input.address]: filtered },
    },
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

// ---------------------------------------------------------------------------
// Update settings mutation
// ---------------------------------------------------------------------------

export type UpdateSettingsInput = {
  action: 'updateSettings';
  groupId: GroupId;
  address: Address;
  name?: string;
  description?: string;
  writers?: string[];
  protectedBranches?: string[];
  visibility?: 'public' | 'private';
  importedFrom?: string;
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
};

export type UpdateSettingsResult = {
  manifestCid: string;
};

/** Update repo settings — owner only. */
export async function executeUpdateSettings(
  env: Env,
  input: UpdateSettingsInput,
): Promise<UpdateSettingsResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwner(input.address, manifest)) {
    throw new MutationError('Only owners can update settings.', 403);
  }

  const updated: Manifest = {
    ...manifest,
    name: input.name ?? manifest.name,
    description: input.description ?? manifest.description,
    protectedBranches: input.protectedBranches ?? manifest.protectedBranches,
    visibility: input.visibility ?? manifest.visibility,
    acl: {
      ...manifest.acl,
      writers: input.writers ? (input.writers as Address[]) : manifest.acl.writers,
    },
    importedFrom: input.importedFrom ?? manifest.importedFrom,
    encryption: input.encryption ?? manifest.encryption,
    keyBundle: input.keyBundle
      ? ({ ...manifest.keyBundle, ...input.keyBundle } as Manifest['keyBundle'])
      : manifest.keyBundle,
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

// ---------------------------------------------------------------------------
// Tag mutations
// ---------------------------------------------------------------------------

export type CreateTagInput = {
  action: 'createTag';
  groupId: GroupId;
  address: Address;
  name: string;
  target: string;
};

export type DeleteTagInput = {
  action: 'deleteTag';
  groupId: GroupId;
  address: Address;
  name: string;
};

export type TagResult = {
  manifestCid: string;
};

/** Create a tag pointing at a commit CID. */
export async function executeCreateTag(env: Env, input: CreateTagInput): Promise<TagResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwnerOrWriter(input.address, manifest)) {
    throw new MutationError('Not authorized.', 403);
  }

  const tags = manifest.tags ?? {};
  if (tags[input.name]) throw new MutationError(`Tag "${input.name}" already exists.`, 409);

  const updated: Manifest = {
    ...manifest,
    tags: { ...tags, [input.name]: input.target },
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

/** Delete a tag. */
export async function executeDeleteTag(env: Env, input: DeleteTagInput): Promise<TagResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwnerOrWriter(input.address, manifest)) {
    throw new MutationError('Not authorized.', 403);
  }

  const tags = manifest.tags ?? {};
  if (!tags[input.name]) throw new MutationError(`Tag "${input.name}" not found.`, 404);

  const { [input.name]: _, ...remaining } = tags;
  const updated: Manifest = {
    ...manifest,
    tags: remaining,
    version: (manifest.version ?? 0) + 1,
  };
  const upload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, upload.cid);

  return { manifestCid: upload.cid };
}

// ---------------------------------------------------------------------------
// Pull Request mutations
// ---------------------------------------------------------------------------

export type CreatePRInput = {
  action: 'createPR';
  groupId: GroupId;
  address: Address;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
};

export type UpdatePRInput = {
  action: 'updatePR';
  groupId: GroupId;
  address: Address;
  prCid: string;
  status: 'open' | 'merged' | 'closed';
};

export type PRResult = {
  prCid: string;
  manifestCid: string;
};

/** Create a pull request. */
export async function executeCreatePR(env: Env, input: CreatePRInput): Promise<PRResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwnerOrWriter(input.address, manifest)) {
    throw new MutationError('Not authorized.', 403);
  }

  if (!manifest.branches[input.sourceBranch]) {
    throw new MutationError(`Source branch "${input.sourceBranch}" not found.`, 404);
  }
  if (!manifest.branches[input.targetBranch]) {
    throw new MutationError(`Target branch "${input.targetBranch}" not found.`, 404);
  }

  const now = new Date().toISOString();
  const pr: PullRequest = {
    type: 'pullRequest',
    title: input.title,
    description: input.description,
    author: input.address,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  const prUpload = await pinJSON(provider, pr, input.groupId);

  const updated: Manifest = {
    ...manifest,
    pullRequests: [...(manifest.pullRequests ?? []), prUpload.cid],
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  return { prCid: prUpload.cid, manifestCid: manifestUpload.cid };
}

/** Update a PR status (close or merge). */
export async function executeUpdatePR(env: Env, input: UpdatePRInput): Promise<PRResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwnerOrWriter(input.address, manifest)) {
    throw new MutationError('Not authorized.', 403);
  }

  const existingPR = await fetchJSON<PullRequest>(env, input.prCid);
  const updatedPR: PullRequest = {
    ...existingPR,
    status: input.status,
    updatedAt: new Date().toISOString(),
  };
  const prUpload = await pinJSON(provider, updatedPR, input.groupId);

  // Unpin superseded PR object (best-effort)
  provider.unpin(input.prCid).catch(() => {});

  // Replace old CID with new in manifest
  const prs = (manifest.pullRequests ?? []).map((c) => (c === input.prCid ? prUpload.cid : c));
  const updated: Manifest = {
    ...manifest,
    pullRequests: prs,
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  return { prCid: prUpload.cid, manifestCid: manifestUpload.cid };
}

// ---------------------------------------------------------------------------
// Toggle Pages mutation
// ---------------------------------------------------------------------------

export type TogglePagesInput = {
  action: 'togglePages';
  groupId: GroupId;
  address: Address;
  enabled: boolean;
  slug?: string;
  branch?: string;
  folder?: string;
};

export type TogglePagesResult = {
  manifestCid: string;
  slug: string | null;
};

/** Slug regex: 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Enable or disable GitLike Pages for a repo. */
export async function executeTogglePages(
  env: Env,
  input: TogglePagesInput,
): Promise<TogglePagesResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  if (!isOwner(input.address, manifest)) {
    throw new MutationError('Only owners can manage Pages.', 403);
  }

  if (input.enabled) {
    const raw = input.slug ?? manifest.name;
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!SLUG_RE.test(slug)) throw new MutationError('Invalid pages slug.', 400);

    // Check uniqueness
    const existing = await env.SESSIONS.get(`pages:${slug}`);
    if (existing && existing !== input.groupId) {
      throw new MutationError(`Slug "${slug}" is already taken.`, 409);
    }

    // If renaming slug, delete old one
    const oldSlug = manifest.pages?.slug;
    if (oldSlug && oldSlug !== slug) {
      await env.SESSIONS.delete(`pages:${oldSlug}`);
    }

    await env.SESSIONS.put(`pages:${slug}`, input.groupId);

    const branch = input.branch ?? manifest.pages?.branch ?? manifest.defaultBranch;
    const folder = input.folder !== undefined ? input.folder || undefined : manifest.pages?.folder;
    const updated: Manifest = {
      ...manifest,
      pages: { enabled: true, branch, slug, ...(folder ? { folder } : {}) },
      version: (manifest.version ?? 0) + 1,
    };
    const upload = await pinJSON(provider, updated, input.groupId);
    await storeManifestCid(provider, env, input.groupId, upload.cid);

    return { manifestCid: upload.cid, slug };
  } else {
    // Disable pages
    const oldSlug = manifest.pages?.slug;
    if (oldSlug) await env.SESSIONS.delete(`pages:${oldSlug}`);

    const { pages: _, ...rest } = manifest;
    const updated: Manifest = {
      ...rest,
      version: (manifest.version ?? 0) + 1,
    } as Manifest;
    const upload = await pinJSON(provider, updated, input.groupId);
    await storeManifestCid(provider, env, input.groupId, upload.cid);

    return { manifestCid: upload.cid, slug: null };
  }
}

// ---------------------------------------------------------------------------
// Issue mutations
// ---------------------------------------------------------------------------

export type CreateIssueInput = {
  action: 'createIssue';
  groupId: GroupId;
  address: Address;
  title: string;
  body: string;
  labels: string[];
};

export type UpdateIssueInput = {
  action: 'updateIssue';
  groupId: GroupId;
  address: Address;
  issueCid: string;
  status?: 'open' | 'closed';
  comment?: string;
  labels?: string[];
};

export type IssueResult = {
  issueCid: string;
  manifestCid: string;
};

/** Create a new issue. */
export async function executeCreateIssue(env: Env, input: CreateIssueInput): Promise<IssueResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  const now = new Date().toISOString();
  const number = (manifest.issueCount ?? 0) + 1;
  const issue: Issue = {
    type: 'issue',
    number,
    title: input.title,
    body: input.body,
    author: input.address,
    status: 'open',
    labels: input.labels,
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
  const issueUpload = await pinJSON(provider, issue, input.groupId);

  const updated: Manifest = {
    ...manifest,
    issues: [...(manifest.issues ?? []), issueUpload.cid],
    issueCount: number,
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  return { issueCid: issueUpload.cid, manifestCid: manifestUpload.cid };
}

/** Update an issue (comment, close/reopen, labels). */
export async function executeUpdateIssue(env: Env, input: UpdateIssueInput): Promise<IssueResult> {
  const provider = createStorage(env);

  const manifest = await fetchManifest(provider, env, input.groupId);
  if (!manifest) throw new MutationError('Repository not found.', 404);

  const existing = await fetchJSON<Issue>(env, input.issueCid);
  const now = new Date().toISOString();

  const comments = [...existing.comments];
  if (input.comment) {
    comments.push({ author: input.address, body: input.comment, createdAt: now });
  }

  const updatedIssue: Issue = {
    ...existing,
    status: input.status ?? existing.status,
    labels: input.labels ?? existing.labels,
    comments,
    updatedAt: now,
  };
  const issueUpload = await pinJSON(provider, updatedIssue, input.groupId);

  // Unpin superseded issue object (best-effort)
  provider.unpin(input.issueCid).catch(() => {});

  // Replace old CID with new in manifest
  const issues = (manifest.issues ?? []).map((c) => (c === input.issueCid ? issueUpload.cid : c));
  const updated: Manifest = {
    ...manifest,
    issues,
    version: (manifest.version ?? 0) + 1,
  };
  const manifestUpload = await pinJSON(provider, updated, input.groupId);
  await storeManifestCid(provider, env, input.groupId, manifestUpload.cid);

  return { issueCid: issueUpload.cid, manifestCid: manifestUpload.cid };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type MutationInput =
  | CommitInput
  | BranchInput
  | MergeInput
  | DeleteBranchInput
  | UpdateSettingsInput
  | CreateTagInput
  | DeleteTagInput
  | CreatePRInput
  | UpdatePRInput
  | DelegationInput
  | RevokeDelegationInput
  | TogglePagesInput
  | CreateIssueInput
  | UpdateIssueInput;

export type MutationResult =
  | CommitResult
  | BranchResult
  | MergeResult
  | DeleteBranchResult
  | UpdateSettingsResult
  | TagResult
  | PRResult
  | DelegationResult
  | RevokeDelegationResult
  | TogglePagesResult
  | IssueResult;

/** Dispatch a mutation by action type. */
export async function dispatchMutation(env: Env, input: MutationInput): Promise<MutationResult> {
  switch (input.action) {
    case 'commit':
      return executeCommit(env, input);
    case 'branch':
      return executeBranch(env, input);
    case 'merge':
      return executeMerge(env, input);
    case 'deleteBranch':
      return executeDeleteBranch(env, input);
    case 'updateSettings':
      return executeUpdateSettings(env, input);
    case 'createTag':
      return executeCreateTag(env, input);
    case 'deleteTag':
      return executeDeleteTag(env, input);
    case 'createPR':
      return executeCreatePR(env, input);
    case 'updatePR':
      return executeUpdatePR(env, input);
    case 'delegation':
      return executeDelegation(env, input);
    case 'revokeDelegation':
      return executeRevokeDelegation(env, input);
    case 'togglePages':
      return executeTogglePages(env, input);
    case 'createIssue':
      return executeCreateIssue(env, input);
    case 'updateIssue':
      return executeUpdateIssue(env, input);
    default:
      throw new MutationError(`Unknown action: ${(input as { action: string }).action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Activity tracking
// ---------------------------------------------------------------------------

/** Record a contribution for the given address on today's date (best-effort). */
export async function recordActivity(env: Env, address: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const key = `activity:${address.toLowerCase()}:${year}`;

  try {
    const raw = await env.SESSIONS.get(key);
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    counts[today] = (counts[today] ?? 0) + 1;
    await env.SESSIONS.put(key, JSON.stringify(counts));
  } catch {
    // Best-effort — don't fail the mutation if activity tracking breaks
  }
}

// ---------------------------------------------------------------------------
// ACL helpers
// ---------------------------------------------------------------------------

function isOwner(address: string, manifest: Manifest): boolean {
  const lower = address.toLowerCase();
  return manifest.acl.owners.some((a) => a.toLowerCase() === lower);
}

function isOwnerOrWriter(address: string, manifest: Manifest): boolean {
  const lower = address.toLowerCase();
  return (
    manifest.acl.owners.some((a) => a.toLowerCase() === lower) ||
    manifest.acl.writers.some((a) => a.toLowerCase() === lower)
  );
}

/**
 * Check if an address is a delegated agent.
 * When action is omitted, checks only address + expiry (for read access).
 * When action is provided, also checks scope and paths.
 */
export function isDelegatedAgent(
  address: string,
  manifest: Manifest,
  action?: string,
  paths?: string[],
): boolean {
  const lower = address.toLowerCase();
  const now = new Date();
  for (const entries of Object.values(manifest.acl.agents)) {
    for (const entry of entries) {
      if (entry.key.toLowerCase() !== lower) continue;
      if (new Date(entry.expires) <= now) continue;
      // If no action specified, any valid delegation grants access (read)
      if (!action) return true;
      if (!entry.scope.actions.includes(action as 'commit' | 'branch' | 'merge')) continue;
      if (paths && paths.length > 0 && !entry.scope.paths.includes('*')) {
        const allowed = entry.scope.paths;
        const allCovered = paths.every((p) => allowed.some((pattern) => globMatch(pattern, p)));
        if (!allCovered) continue;
      }
      return true;
    }
  }
  return false;
}

/** Find the delegation CID for an agent address. */
function findDelegationCid(address: string, manifest: Manifest): string | undefined {
  const lower = address.toLowerCase();
  const now = new Date();
  for (const entries of Object.values(manifest.acl.agents)) {
    for (const entry of entries) {
      if (entry.key.toLowerCase() !== lower) continue;
      if (new Date(entry.expires) <= now) continue;
      return entry.delegationCid;
    }
  }
  return undefined;
}

/** Remove expired delegation entries from a manifest's ACL. */
export function pruneExpiredDelegations(manifest: Manifest): Manifest {
  const now = new Date();
  let pruned = false;
  const agents: typeof manifest.acl.agents = {};
  for (const [owner, entries] of Object.entries(manifest.acl.agents)) {
    const valid = entries.filter((e) => new Date(e.expires) > now);
    if (valid.length !== entries.length) pruned = true;
    if (valid.length > 0) agents[owner] = valid;
  }
  if (!pruned) return manifest;
  return { ...manifest, acl: { ...manifest.acl, agents } };
}

/** Simple glob matching — supports `*` (any segment) and `**` (any depth). */
function globMatch(pattern: string, path: string): boolean {
  if (pattern === '*') return true;
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*');
  return new RegExp(`^${re}$`).test(path);
}

// ---------------------------------------------------------------------------
// Error type with status code
// ---------------------------------------------------------------------------

export class MutationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'MutationError';
  }
}
