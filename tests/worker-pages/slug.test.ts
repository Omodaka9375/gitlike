import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the slug sanitization + validation from mutations.ts for testing.
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Sanitize a raw string into a slug (same logic as executeTogglePages). */
function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Check if a slug is valid. */
function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

describe('sanitizeSlug', () => {
  it('lowercases the input', () => {
    expect(sanitizeSlug('MyProject')).toBe('myproject');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeSlug('my project')).toBe('my-project');
  });

  it('replaces special characters with hyphens', () => {
    expect(sanitizeSlug('my@project!v2')).toBe('my-project-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeSlug('my---project')).toBe('my-project');
  });

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeSlug('-my-project-')).toBe('my-project');
  });

  it('handles dots and underscores', () => {
    expect(sanitizeSlug('my.project_v2')).toBe('my-project-v2');
  });

  it('passes through already-valid slugs', () => {
    expect(sanitizeSlug('my-repo')).toBe('my-repo');
    expect(sanitizeSlug('project123')).toBe('project123');
  });

  it('handles owner/repo format', () => {
    expect(sanitizeSlug('owner/repo')).toBe('owner-repo');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('isValidSlug', () => {
  it('accepts simple slugs', () => {
    expect(isValidSlug('my-repo')).toBe(true);
    expect(isValidSlug('project123')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('accepts single character', () => {
    expect(isValidSlug('x')).toBe(true);
    expect(isValidSlug('5')).toBe(true);
  });

  it('accepts max-length slug (64 chars)', () => {
    expect(isValidSlug('a' + 'b'.repeat(62) + 'c')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects leading hyphen', () => {
    expect(isValidSlug('-my-repo')).toBe(false);
  });

  it('rejects trailing hyphen', () => {
    expect(isValidSlug('my-repo-')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValidSlug('MyRepo')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidSlug('my repo')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidSlug('my@repo')).toBe(false);
    expect(isValidSlug('my.repo')).toBe(false);
    expect(isValidSlug('my_repo')).toBe(false);
  });

  it('rejects slugs over 64 chars', () => {
    expect(isValidSlug('a'.repeat(65))).toBe(false);
  });

  it('accepts hyphens in the middle', () => {
    expect(isValidSlug('a-b-c-d')).toBe(true);
    expect(isValidSlug('my-cool-project-2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: sanitize then validate
// ---------------------------------------------------------------------------

describe('sanitize → validate', () => {
  it('produces valid slugs from typical repo names', () => {
    expect(isValidSlug(sanitizeSlug('my-project'))).toBe(true);
    expect(isValidSlug(sanitizeSlug('MyProject'))).toBe(true);
    expect(isValidSlug(sanitizeSlug('project_v2.0'))).toBe(true);
    expect(isValidSlug(sanitizeSlug('owner/cool-repo'))).toBe(true);
  });

  it('produces valid slug from names with special chars', () => {
    const slug = sanitizeSlug('Hello World! (v2)');
    expect(slug).toBe('hello-world-v2');
    expect(isValidSlug(slug)).toBe(true);
  });
});
