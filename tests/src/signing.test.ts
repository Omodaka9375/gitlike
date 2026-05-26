import { describe, it, expect, beforeAll } from 'vitest';

// isAuthorized was removed — equivalent logic lives in worker/utils.ts
// (isOwnerOrWriter) and is tested in worker tests.

describe('signing module', () => {
  // Cache the dynamic import — viem + WalletConnect deps are slow to load
  let mod: typeof import('../../src/signing.js');

  beforeAll(async () => {
    mod = await import('../../src/signing.js');
  }, 30_000);

  it('exports signAndRegisterCommit', () => {
    expect(typeof mod.signAndRegisterCommit).toBe('function');
  });

  it('exports signCommit', () => {
    expect(typeof mod.signCommit).toBe('function');
  });

  it('exports signDelegation', () => {
    expect(typeof mod.signDelegation).toBe('function');
  });

  it('exports verifyCommitSignature', () => {
    expect(typeof mod.verifyCommitSignature).toBe('function');
  });

  it('exports verifyDelegationSignature', () => {
    expect(typeof mod.verifyDelegationSignature).toBe('function');
  });

  it('exports fetchAndVerifyCommitSignature', () => {
    expect(typeof mod.fetchAndVerifyCommitSignature).toBe('function');
  });
});
