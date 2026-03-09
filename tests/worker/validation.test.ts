import { describe, it, expect } from 'vitest';
import {
  validateRepoName,
  validateBranchName,
  validateFilePath,
  validateCommitMessage,
  validateCid,
  validateAddress,
} from '../../worker/validation.js';

describe('validateRepoName', () => {
  it('accepts valid names', () => {
    expect(validateRepoName('my-project')).toBeNull();
    expect(validateRepoName('repo123')).toBeNull();
    expect(validateRepoName('a')).toBeNull();
    expect(validateRepoName('my.project_v2')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validateRepoName('')).not.toBeNull();
  });

  it('rejects too long', () => {
    expect(validateRepoName('a'.repeat(101))).not.toBeNull();
  });

  it('rejects names starting with non-alphanumeric', () => {
    expect(validateRepoName('-bad')).not.toBeNull();
    expect(validateRepoName('.bad')).not.toBeNull();
  });

  it('rejects names with spaces', () => {
    expect(validateRepoName('bad name')).not.toBeNull();
  });
});

describe('validateBranchName', () => {
  it('accepts valid names', () => {
    expect(validateBranchName('main')).toBeNull();
    expect(validateBranchName('feature/my-branch')).toBeNull();
    expect(validateBranchName('v1.0.0')).toBeNull();
  });

  it('rejects ".."', () => {
    expect(validateBranchName('a..b')).not.toBeNull();
  });

  it('rejects leading/trailing slashes', () => {
    expect(validateBranchName('/bad')).not.toBeNull();
    expect(validateBranchName('bad/')).not.toBeNull();
  });

  it('rejects trailing dot', () => {
    expect(validateBranchName('bad.')).not.toBeNull();
  });

  it('rejects control characters', () => {
    expect(validateBranchName('bad\x00name')).not.toBeNull();
  });
});

describe('validateFilePath', () => {
  it('accepts valid paths', () => {
    expect(validateFilePath('src/main.ts')).toBeNull();
    expect(validateFilePath('README.md')).toBeNull();
    expect(validateFilePath('a/b/c/d.txt')).toBeNull();
  });

  it('rejects ".."', () => {
    expect(validateFilePath('../etc/passwd')).not.toBeNull();
    expect(validateFilePath('a/../b')).not.toBeNull();
  });

  it('rejects absolute paths', () => {
    expect(validateFilePath('/etc/passwd')).not.toBeNull();
  });

  it('rejects null bytes', () => {
    expect(validateFilePath('file\x00.txt')).not.toBeNull();
  });

  it('rejects too deep', () => {
    const deep = Array.from({ length: 21 }, (_, i) => `d${i}`).join('/');
    expect(validateFilePath(deep)).not.toBeNull();
  });
});

describe('validateCommitMessage', () => {
  it('accepts valid messages', () => {
    expect(validateCommitMessage('Add auth module')).toBeNull();
    expect(validateCommitMessage('a')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validateCommitMessage('')).not.toBeNull();
  });

  it('rejects too long', () => {
    expect(validateCommitMessage('x'.repeat(5001))).not.toBeNull();
  });
});

describe('validateCid', () => {
  it('accepts CIDv1', () => {
    expect(validateCid('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validateCid('')).not.toBeNull();
  });

  it('rejects random strings', () => {
    expect(validateCid('not-a-cid')).not.toBeNull();
  });
});

describe('validateAddress', () => {
  it('accepts valid addresses', () => {
    expect(validateAddress('0x1234567890abcdef1234567890abcdef12345678')).toBeNull();
    expect(validateAddress('0xABCDEF1234567890abcdef1234567890ABCDEF12')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validateAddress('')).not.toBeNull();
  });

  it('rejects without 0x prefix', () => {
    expect(validateAddress('1234567890abcdef1234567890abcdef12345678')).not.toBeNull();
  });

  it('rejects wrong length', () => {
    expect(validateAddress('0x1234')).not.toBeNull();
  });

  it('rejects non-hex characters', () => {
    expect(validateAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).not.toBeNull();
  });
});

// Edge cases for other validators
describe('extra edge cases', () => {
  it('validateRepoName rejects names with special characters', () => {
    expect(validateRepoName('repo@name')).not.toBeNull();
    expect(validateRepoName('repo!name')).not.toBeNull();
  });

  it('validateBranchName accepts nested feature branches', () => {
    expect(validateBranchName('feature/auth/oauth')).toBeNull();
  });

  it('validateBranchName rejects empty', () => {
    expect(validateBranchName('')).not.toBeNull();
  });

  it('validateFilePath rejects empty', () => {
    expect(validateFilePath('')).not.toBeNull();
  });

  it('validateCid accepts Qm-style CIDv0', () => {
    expect(validateCid('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBeNull();
  });

  it('validateCommitMessage accepts max-length message', () => {
    expect(validateCommitMessage('x'.repeat(5000))).toBeNull();
  });
});
