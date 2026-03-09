import { describe, it, expect } from 'vitest';
import { parsePath, buildPath, buildCommitsPath } from '../../src/ui/router.js';

describe('parsePath', () => {
  it('returns home for empty path', () => {
    const route = parsePath('');
    expect(route.view).toBe('home');
  });

  it('returns home for "/"', () => {
    const route = parsePath('/');
    expect(route.view).toBe('home');
  });

  it('parses repo root', () => {
    const route = parsePath('/group123/main');
    expect(route.view).toBe('repo');
    expect(route.slug).toBe('group123');
    expect(route.branch).toBe('main');
    expect(route.path).toBe('');
  });

  it('defaults branch to main', () => {
    const route = parsePath('/group123');
    expect(route.view).toBe('repo');
    expect(route.branch).toBe('main');
  });

  it('parses tree/blob path', () => {
    const route = parsePath('/group123/main/src/lib/foo.ts');
    expect(route.view).toBe('tree');
    expect(route.slug).toBe('group123');
    expect(route.branch).toBe('main');
    expect(route.path).toBe('src/lib/foo.ts');
    expect(route.segments).toEqual(['src', 'lib', 'foo.ts']);
  });

  it('parses commits view', () => {
    const route = parsePath('/group123/commits/main');
    expect(route.view).toBe('commits');
    expect(route.slug).toBe('group123');
    expect(route.branch).toBe('main');
  });

  it('defaults commits branch to main', () => {
    const route = parsePath('/group123/commits');
    expect(route.view).toBe('commits');
    expect(route.branch).toBe('main');
  });

  it('parses commit detail view', () => {
    const route = parsePath('/group123/commit/bafyCid123');
    expect(route.view).toBe('commit');
    expect(route.slug).toBe('group123');
    expect(route.commitCid).toBe('bafyCid123');
  });

  it('parses PR list view', () => {
    const route = parsePath('/group123/prs');
    expect(route.view).toBe('prs');
    expect(route.slug).toBe('group123');
  });

  it('parses PR detail view', () => {
    const route = parsePath('/group123/pr/bafyPrCid');
    expect(route.view).toBe('pr');
    expect(route.slug).toBe('group123');
    expect(route.prCid).toBe('bafyPrCid');
  });

  it('parses user profile route', () => {
    const route = parsePath('/user/0xAbC123');
    expect(route.view).toBe('user');
    expect(route.address).toBe('0xAbC123');
  });

  it('treats /<group> without branch as repo with default main', () => {
    const route = parsePath('/mygroup');
    expect(route.view).toBe('repo');
    expect(route.slug).toBe('mygroup');
    expect(route.branch).toBe('main');
  });
});

describe('buildPath', () => {
  it('builds base path', () => {
    expect(buildPath('g1')).toBe('/g1/main');
  });

  it('builds path with branch', () => {
    expect(buildPath('g1', 'dev')).toBe('/g1/dev');
  });

  it('builds path with file path', () => {
    expect(buildPath('g1', 'main', 'src/foo.ts')).toBe('/g1/main/src/foo.ts');
  });

  it('falls back to main when branch is empty', () => {
    expect(buildPath('g1', '')).toBe('/g1/main');
    expect(buildPath('g1', '', 'foo.js')).toBe('/g1/main/foo.js');
  });
});

describe('buildCommitsPath', () => {
  it('builds commits path', () => {
    expect(buildCommitsPath('g1', 'main')).toBe('/g1/commits/main');
  });
});
