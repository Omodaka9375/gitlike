// ---------------------------------------------------------------------------
// GitLike — Commit & Delegation Signing
// Uses EIP-712 typed data signatures via viem.
// ---------------------------------------------------------------------------

import { walletClient, connectedAddress } from './wallet.js';
import type { CID, Commit, Delegation } from './types.js';
import { verifyTypedData } from 'viem';
import { CHAIN_ID } from './config.js';

// ---------------------------------------------------------------------------
// EIP-712 Domain & Types
// ---------------------------------------------------------------------------

const DOMAIN = {
  name: 'GitLike',
  version: '1',
  chainId: CHAIN_ID,
} as const;

const COMMIT_TYPES = {
  Commit: [
    { name: 'cid', type: 'string' },
    { name: 'tree', type: 'string' },
    { name: 'message', type: 'string' },
    { name: 'author', type: 'address' },
    { name: 'timestamp', type: 'string' },
  ],
} as const;

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

// ---------------------------------------------------------------------------
// Sign a Commit
// ---------------------------------------------------------------------------

/** Sign a commit CID with the connected wallet (registration happens server-side). */
export async function signCommit(cid: CID, commit: Commit): Promise<`0x${string}`> {
  const address = connectedAddress();
  if (!address) throw new Error('Wallet not connected.');

  return walletClient().signTypedData({
    account: address,
    domain: DOMAIN,
    types: COMMIT_TYPES,
    primaryType: 'Commit',
    message: {
      cid,
      tree: commit.tree,
      message: commit.message,
      author: commit.author,
      timestamp: commit.timestamp,
    },
  });
}

// ---------------------------------------------------------------------------
// Sign a Delegation
// ---------------------------------------------------------------------------

/** Sign a delegation token with the connected wallet. */
export async function signDelegation(
  delegation: Omit<Delegation, 'signature'>,
): Promise<`0x${string}`> {
  const address = connectedAddress();
  if (!address) throw new Error('Wallet not connected.');
  if (address.toLowerCase() !== delegation.delegator.toLowerCase()) {
    throw new Error('Connected wallet does not match delegator.');
  }

  return walletClient().signTypedData({
    account: address,
    domain: DOMAIN,
    types: DELEGATION_TYPES,
    primaryType: 'Delegation',
    message: {
      delegator: delegation.delegator,
      agent: delegation.agent,
      repo: delegation.repo,
      actions: delegation.scope.actions.join(','),
      paths: delegation.scope.paths.join(','),
      expires: delegation.expires,
    },
  });
}

// ---------------------------------------------------------------------------
// Verify Signatures
// ---------------------------------------------------------------------------

/** Verify a commit signature. Returns the recovered signer address. */
export async function verifyCommitSignature(
  cid: CID,
  commit: Commit,
  signature: `0x${string}`,
): Promise<boolean> {
  return verifyTypedData({
    address: commit.author,
    domain: DOMAIN,
    types: COMMIT_TYPES,
    primaryType: 'Commit',
    message: {
      cid,
      tree: commit.tree,
      message: commit.message,
      author: commit.author,
      timestamp: commit.timestamp,
    },
    signature,
  });
}

/** Verify a delegation signature. */
export async function verifyDelegationSignature(delegation: Delegation): Promise<boolean> {
  return verifyTypedData({
    address: delegation.delegator,
    domain: DOMAIN,
    types: DELEGATION_TYPES,
    primaryType: 'Delegation',
    message: {
      delegator: delegation.delegator,
      agent: delegation.agent,
      repo: delegation.repo,
      actions: delegation.scope.actions.join(','),
      paths: delegation.scope.paths.join(','),
      expires: delegation.expires,
    },
    signature: delegation.signature,
  });
}

/** Fetch a commit's Pinata signature and verify it client-side. */
export async function fetchAndVerifyCommitSignature(
  cid: CID,
  commit: Commit,
  repoId?: string,
): Promise<{ verified: boolean; signature: string | null }> {
  try {
    const sigUrl = repoId
      ? `/api/repos/${repoId}/signature/${cid}`
      : `/api/repos/_/signature/${cid}`;
    const res = await fetch(sigUrl);
    if (!res.ok) return { verified: false, signature: null };
    const data = (await res.json()) as { cid: string; signature: string | null };
    if (!data.signature) return { verified: false, signature: null };

    const hex = data.signature as `0x${string}`;
    const valid = await verifyCommitSignature(cid, commit, hex);
    return { verified: valid, signature: data.signature };
  } catch {
    return { verified: false, signature: null };
  }
}

/** Sign a commit and register the signature with the server (best-effort). */
export async function signAndRegisterCommit(repoId: string, commitCid: CID): Promise<void> {
  try {
    const { fetchJSON, registerSignature } = await import('./api.js');
    const commit = await fetchJSON<Commit>(commitCid);
    const signature = await signCommit(commitCid, commit);
    await registerSignature(repoId, commitCid, signature);
  } catch {
    // Signing is best-effort — don't block the user flow
  }
}
