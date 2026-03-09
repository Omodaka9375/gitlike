import { describe, it, expect } from 'vitest';
import { generateRepoOgImage } from '../../worker/og-image.js';
import type { Manifest } from '../../worker/ipfs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    type: 'manifest',
    name: 'test-repo',
    description: 'A test repository',
    defaultBranch: 'main',
    branches: { main: 'cidMain' },
    acl: {
      owners: ['0xAbC1230000000000000000000000000000000001'] as Manifest['acl']['owners'],
      writers: [] as Manifest['acl']['writers'],
      agents: {},
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateRepoOgImage
// ---------------------------------------------------------------------------

describe('generateRepoOgImage', () => {
  it('returns valid SVG', () => {
    const svg = generateRepoOgImage(makeManifest());
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('includes the repo name', () => {
    const svg = generateRepoOgImage(makeManifest({ name: 'my-cool-repo' }));
    expect(svg).toContain('my-cool-repo');
  });

  it('includes the description', () => {
    const svg = generateRepoOgImage(makeManifest({ description: 'Hello world' }));
    expect(svg).toContain('Hello world');
  });

  it('shows branch count', () => {
    const svg = generateRepoOgImage(
      makeManifest({ branches: { main: 'c1', dev: 'c2', feature: 'c3' } }),
    );
    expect(svg).toContain('3 branches');
  });

  it('shows singular branch when count is 1', () => {
    const svg = generateRepoOgImage(makeManifest({ branches: { main: 'c1' } }));
    expect(svg).toContain('1 branch');
    expect(svg).not.toContain('1 branches');
  });

  it('shows tag count when tags exist', () => {
    const svg = generateRepoOgImage(makeManifest({ tags: { v1: 'c1', v2: 'c2' } }));
    expect(svg).toContain('2 tags');
  });

  it('omits tag count when no tags', () => {
    const svg = generateRepoOgImage(makeManifest());
    expect(svg).not.toContain('tag');
  });

  it('shows Private badge for private repos', () => {
    const svg = generateRepoOgImage(makeManifest({ visibility: 'private' }));
    expect(svg).toContain('Private');
  });

  it('shows Public badge for public repos', () => {
    const svg = generateRepoOgImage(makeManifest({ visibility: 'public' }));
    expect(svg).toContain('Public');
  });

  it('escapes HTML entities in name', () => {
    const svg = generateRepoOgImage(makeManifest({ name: '<script>alert("xss")</script>' }));
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('escapes HTML entities in description', () => {
    const svg = generateRepoOgImage(makeManifest({ description: 'A & B "quoted"' }));
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('truncates long descriptions', () => {
    const longDesc = 'a'.repeat(200);
    const svg = generateRepoOgImage(makeManifest({ description: longDesc }));
    // Should not contain the full 200 chars
    expect(svg).not.toContain(longDesc);
    expect(svg).toContain('…');
  });

  it('shows abbreviated owner address', () => {
    const svg = generateRepoOgImage(makeManifest());
    // Should show short form like 0xAbC1...0001
    expect(svg).toContain('0xAbC1');
  });

  it('includes GitLike branding', () => {
    const svg = generateRepoOgImage(makeManifest());
    expect(svg).toContain('GitLike');
    expect(svg).toContain('gitlike.dev');
  });

  it('handles missing description gracefully', () => {
    const svg = generateRepoOgImage(makeManifest({ description: '' }));
    expect(svg).toContain('No description');
  });

  it('handles missing name gracefully', () => {
    const svg = generateRepoOgImage(makeManifest({ name: '' }));
    expect(svg).toContain('Untitled');
  });
});
