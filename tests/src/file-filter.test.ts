import { describe, it, expect } from 'vitest';
import { shouldIgnore, filterPaths, parseGitignore } from '../../src/file-filter.js';

describe('shouldIgnore', () => {
  it('skips files in dot-directories', () => {
    expect(shouldIgnore('.git/config')).toBe(true);
    expect(shouldIgnore('.vscode/settings.json')).toBe(true);
    expect(shouldIgnore('.idea/workspace.xml')).toBe(true);
    expect(shouldIgnore('src/.hidden/file.ts')).toBe(true);
  });

  it('allows dot-files at root', () => {
    expect(shouldIgnore('.gitignore')).toBe(false);
    expect(shouldIgnore('.editorconfig')).toBe(false);
    expect(shouldIgnore('.env.example')).toBe(false);
  });

  it('skips OS junk files', () => {
    expect(shouldIgnore('.DS_Store')).toBe(true);
    expect(shouldIgnore('Thumbs.db')).toBe(true);
    expect(shouldIgnore('desktop.ini')).toBe(true);
    expect(shouldIgnore('src/Thumbs.db')).toBe(true);
  });

  it('allows normal files', () => {
    expect(shouldIgnore('src/main.ts')).toBe(false);
    expect(shouldIgnore('README.md')).toBe(false);
    expect(shouldIgnore('src/utils/helpers.ts')).toBe(false);
  });

  it('respects gitignore patterns', () => {
    const patterns = ['node_modules/', '*.log', 'dist/'];
    expect(shouldIgnore('node_modules/express/index.js', patterns)).toBe(true);
    expect(shouldIgnore('error.log', patterns)).toBe(true);
    expect(shouldIgnore('dist/bundle.js', patterns)).toBe(true);
    expect(shouldIgnore('src/index.ts', patterns)).toBe(false);
  });

  it('handles negation patterns', () => {
    const patterns = ['*.log', '!important.log'];
    expect(shouldIgnore('error.log', patterns)).toBe(true);
    expect(shouldIgnore('important.log', patterns)).toBe(false);
  });

  it('handles wildcard patterns', () => {
    const patterns = ['*.min.js', 'build/**'];
    expect(shouldIgnore('app.min.js', patterns)).toBe(true);
    expect(shouldIgnore('build/output/file.js', patterns)).toBe(true);
    expect(shouldIgnore('src/app.js', patterns)).toBe(false);
  });
});

describe('filterPaths', () => {
  it('filters out ignored paths', () => {
    const paths = ['src/main.ts', '.git/config', 'README.md', '.DS_Store', 'node_modules/x/y.js'];
    const result = filterPaths(paths, ['node_modules/']);
    expect(result).toEqual(['src/main.ts', 'README.md']);
  });
});

describe('parseGitignore', () => {
  it('parses a .gitignore file', () => {
    const content = '# comment\nnode_modules/\n\n*.log\n!important.log\n';
    const patterns = parseGitignore(content);
    expect(patterns).toEqual(['node_modules/', '*.log', '!important.log']);
  });

  it('strips trailing whitespace', () => {
    const patterns = parseGitignore('dist/   \nbuild/\n');
    expect(patterns).toEqual(['dist/', 'build/']);
  });
});
