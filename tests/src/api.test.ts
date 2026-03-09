import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from '../../src/api.js';

describe('parseRepoUrl', () => {
  it('parses GitHub HTTPS URLs', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo', branch: undefined });
  });

  it('parses GitHub URLs with .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo', branch: undefined });
  });

  it('parses GitHub URLs with branch', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/tree/develop');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo', branch: 'develop' });
  });

  it('parses GitHub URLs without protocol', () => {
    const result = parseRepoUrl('github.com/owner/repo');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo', branch: undefined });
  });

  it('parses GitLab URLs', () => {
    const result = parseRepoUrl('https://gitlab.com/owner/repo');
    expect(result).toEqual({ platform: 'gitlab', owner: 'owner', repo: 'repo', branch: undefined });
  });

  it('parses GitLab URLs with branch', () => {
    const result = parseRepoUrl('https://gitlab.com/owner/repo/-/tree/main');
    expect(result).toEqual({ platform: 'gitlab', owner: 'owner', repo: 'repo', branch: 'main' });
  });

  it('returns null for unrecognized URLs', () => {
    expect(parseRepoUrl('https://bitbucket.org/owner/repo')).toBeNull();
    expect(parseRepoUrl('not-a-url')).toBeNull();
    expect(parseRepoUrl('')).toBeNull();
  });
});
