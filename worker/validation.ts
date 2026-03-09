// ---------------------------------------------------------------------------
// GitLike — Input Validation
// ---------------------------------------------------------------------------

/** Validate a repository name. */
export function validateRepoName(name: string): string | null {
  if (!name || name.length > 100) return 'Repo name must be 1-100 characters.';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    return 'Repo name must start with alphanumeric and contain only alphanumeric, hyphens, dots, underscores.';
  }
  return null;
}

/** Validate a branch name. */
export function validateBranchName(name: string): string | null {
  if (!name || name.length > 200) return 'Branch name must be 1-200 characters.';
  if (/\.\./.test(name)) return 'Branch name must not contain "..".';
  if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(name)) return 'Branch name contains invalid characters.';
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
    return 'Branch name must not start/end with "/" or end with ".".';
  }
  return null;
}

/** Validate a file path within a repo. */
export function validateFilePath(path: string): string | null {
  if (!path || path.length > 500) return 'File path must be 1-500 characters.';
  if (/\.\./.test(path)) return 'File path must not contain "..".';
  if (/\x00/.test(path)) return 'File path must not contain null bytes.';
  if (path.startsWith('/')) return 'File path must be relative (no leading slash).';
  const depth = path.split('/').length;
  if (depth > 20) return 'File path too deeply nested (max 20 levels).';
  return null;
}

/** Validate a commit message. */
export function validateCommitMessage(message: string): string | null {
  if (!message || message.length > 5000) return 'Commit message must be 1-5000 characters.';
  return null;
}

/** Validate a CID format. */
export function validateCid(cid: string): string | null {
  if (!cid) return 'CID is required.';
  // CIDv0: starts with Qm, 46 chars total, base58btc alphabet
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) return null;
  // CIDv1: base32-encoded, starts with "b", typically "bafy..." for dag-pb/sha256
  if (/^b[a-z2-7]{58,}$/.test(cid)) return null;
  return 'Invalid CID format.';
}

/** Validate a hex Ethereum address. */
export function validateAddress(address: string): string | null {
  if (!address) return 'Address is required.';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return 'Invalid Ethereum address.';
  return null;
}

/** Validate manifest encryption config and key bundle. */
export function validateEncryptionFields(
  encryption?: {
    enabled?: boolean;
    algorithm?: string;
    currentEpoch?: number;
    encryptTreeNames?: boolean;
  },
  keyBundle?: Record<string, unknown>,
): string | null {
  if (!encryption) return null;

  if (typeof encryption.enabled !== 'boolean') return 'encryption.enabled must be a boolean.';
  if (encryption.algorithm && encryption.algorithm !== 'AES-256-GCM') {
    return 'encryption.algorithm must be "AES-256-GCM".';
  }
  if (typeof encryption.currentEpoch !== 'number' || encryption.currentEpoch < 0) {
    return 'encryption.currentEpoch must be a non-negative number.';
  }
  if (
    encryption.encryptTreeNames !== undefined &&
    typeof encryption.encryptTreeNames !== 'boolean'
  ) {
    return 'encryption.encryptTreeNames must be a boolean.';
  }

  if (encryption.enabled && !keyBundle) {
    return 'keyBundle is required when encryption is enabled.';
  }

  if (keyBundle) {
    for (const [epochStr, epoch] of Object.entries(keyBundle)) {
      const epochNum = Number(epochStr);
      if (isNaN(epochNum) || epochNum < 0) {
        return `Invalid epoch key: ${epochStr}.`;
      }
      const e = epoch as Record<string, unknown>;
      if (!e.ownerPublicKey || typeof e.ownerPublicKey !== 'string') {
        return `keyBundle[${epochStr}].ownerPublicKey is required.`;
      }
      if (!e.wrappedKeys || typeof e.wrappedKeys !== 'object') {
        return `keyBundle[${epochStr}].wrappedKeys is required.`;
      }
      if (!e.createdAt || typeof e.createdAt !== 'string') {
        return `keyBundle[${epochStr}].createdAt is required.`;
      }
    }
  }

  return null;
}
