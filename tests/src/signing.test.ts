import { describe, it, expect } from 'vitest';

// isAuthorized was removed — equivalent logic lives in worker/utils.ts
// (isOwnerOrWriter) and is tested in worker tests.

describe('signing module', () => {
  it('exports signAndRegisterCommit', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.signAndRegisterCommit).toBe('function');
  });

  it('exports signCommit', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.signCommit).toBe('function');
  });

  it('exports signDelegation', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.signDelegation).toBe('function');
  });

  it('exports verifyCommitSignature', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.verifyCommitSignature).toBe('function');
  });

  it('exports verifyDelegationSignature', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.verifyDelegationSignature).toBe('function');
  });

  it('exports fetchAndVerifyCommitSignature', async () => {
    const mod = await import('../../src/signing.js');
    expect(typeof mod.fetchAndVerifyCommitSignature).toBe('function');
  });
});
