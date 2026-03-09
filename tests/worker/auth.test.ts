import { describe, it, expect } from 'vitest';
import { parseSiweMessage } from '../../worker/siwe-parser.js';

/** Build a valid SIWE message with optional overrides. */
function buildSiweMessage(overrides: Record<string, string> = {}): string {
  const domain = overrides.domain ?? 'gitlike.dev';
  const address = overrides.address ?? '0xAbC1230000000000000000000000000000000001';
  const statement = overrides.statement ?? 'Sign in to GitLike';
  const uri = overrides.uri ?? 'https://gitlike.dev';
  const version = overrides.version ?? '1';
  const chainId = overrides.chainId ?? '1';
  const nonce = overrides.nonce ?? 'abc123';
  const issuedAt = overrides.issuedAt ?? '2025-01-01T00:00:00Z';

  let msg = `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: ${version}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  if (overrides.expirationTime) {
    msg += `\nExpiration Time: ${overrides.expirationTime}`;
  }
  return msg;
}

describe('parseSiweMessage', () => {
  it('parses a standard SIWE message', () => {
    const result = parseSiweMessage(buildSiweMessage());
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('gitlike.dev');
    expect(result!.address).toBe('0xAbC1230000000000000000000000000000000001');
    expect(result!.nonce).toBe('abc123');
    expect(result!.chainId).toBe('1');
    expect(result!.version).toBe('1');
  });

  it('extracts the statement', () => {
    const result = parseSiweMessage(buildSiweMessage());
    expect(result!.statement).toBe('Sign in to GitLike');
  });

  it('extracts URI and issuedAt', () => {
    const result = parseSiweMessage(buildSiweMessage({ uri: 'https://example.com', issuedAt: '2026-06-01T12:00:00Z' }));
    expect(result!.uri).toBe('https://example.com');
    expect(result!.issuedAt).toBe('2026-06-01T12:00:00Z');
  });

  it('extracts expirationTime when present', () => {
    const result = parseSiweMessage(buildSiweMessage({ expirationTime: '2026-12-31T23:59:59Z' }));
    expect(result!.expirationTime).toBe('2026-12-31T23:59:59Z');
  });

  it('leaves expirationTime undefined when absent', () => {
    const result = parseSiweMessage(buildSiweMessage());
    expect(result!.expirationTime).toBeUndefined();
  });

  it('returns null for empty string', () => {
    expect(parseSiweMessage('')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseSiweMessage('hello world')).toBeNull();
  });

  it('returns null when nonce is missing', () => {
    const msg = `gitlike.dev wants you to sign in with your Ethereum account:\n0xABC\n\nURI: https://gitlike.dev\nVersion: 1\nChain ID: 1\nIssued At: 2025-01-01T00:00:00Z`;
    expect(parseSiweMessage(msg)).toBeNull();
  });

  it('handles different chain IDs', () => {
    const result = parseSiweMessage(buildSiweMessage({ chainId: '11155111' }));
    expect(result!.chainId).toBe('11155111');
  });

  it('handles multi-line statements', () => {
    const result = parseSiweMessage(buildSiweMessage({ statement: 'Line one\nLine two' }));
    expect(result).not.toBeNull();
    expect(result!.statement).toContain('Line one');
    expect(result!.statement).toContain('Line two');
  });
});
