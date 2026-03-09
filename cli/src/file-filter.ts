// ---------------------------------------------------------------------------
// GitLike CLI — File Filter
// Skips dot-directories and respects .gitlikeignore / .gitignore patterns.
// Mirrors logic from src/file-filter.ts, adapted for Node CLI.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files always ignored (case-insensitive). */
const ALWAYS_IGNORED = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Directories always skipped during collection. */
const SKIP_DIRS = new Set(['.gitlike', '.git', 'node_modules']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if a relative file path should be ignored. */
export function shouldIgnore(filePath: string, patterns: string[] = []): boolean {
  const segments = filePath.split('/');

  // Skip files inside dot-directories
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].startsWith('.')) return true;
  }

  // Skip always-ignored files
  const filename = segments[segments.length - 1].toLowerCase();
  if (ALWAYS_IGNORED.has(filename)) return true;

  // Check ignore patterns
  if (patterns.length > 0 && matchesPatterns(filePath, patterns)) return true;

  return false;
}

/** Parse a .gitlikeignore or .gitignore file into pattern strings. */
export function parseIgnoreFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('#'));
}

/** Load ignore patterns from repo root (.gitlikeignore takes priority, falls back to .gitignore). */
export function loadIgnorePatterns(root: string): string[] {
  const gitlikeignore = path.join(root, '.gitlikeignore');
  const gitignore = path.join(root, '.gitignore');

  try {
    if (fs.existsSync(gitlikeignore)) {
      return parseIgnoreFile(fs.readFileSync(gitlikeignore, 'utf-8'));
    }
    if (fs.existsSync(gitignore)) {
      return parseIgnoreFile(fs.readFileSync(gitignore, 'utf-8'));
    }
  } catch {
    // Best-effort
  }
  return [];
}

/** Collect all files in a directory, filtering ignored paths. */
export function collectFiles(root: string, patterns: string[] = []): string[] {
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (!shouldIgnore(rel, patterns)) {
          files.push(rel);
        }
      }
    }
  };

  walk(root);
  return files;
}

// ---------------------------------------------------------------------------
// Internal — pattern matching
// ---------------------------------------------------------------------------

function matchesPatterns(filePath: string, patterns: string[]): boolean {
  let ignored = false;
  for (const raw of patterns) {
    const negate = raw.startsWith('!');
    const pattern = negate ? raw.slice(1) : raw;
    if (patternMatches(filePath, pattern)) {
      ignored = !negate;
    }
  }
  return ignored;
}

function patternMatches(filePath: string, pattern: string): boolean {
  const dirOnly = pattern.endsWith('/');
  const clean = dirOnly ? pattern.slice(0, -1) : pattern;
  const anchored = clean.includes('/');

  if (anchored) {
    const p = clean.startsWith('/') ? clean.slice(1) : clean;
    if (dirOnly) {
      return filePath.startsWith(p + '/') || filePath === p;
    }
    return globMatch(filePath, p);
  }

  const segments = filePath.split('/');
  if (dirOnly) {
    return segments.slice(0, -1).some((s) => globMatch(s, clean));
  }

  return globMatch(segments[segments.length - 1], clean) || globMatch(filePath, '**/' + clean);
}

function globMatch(text: string, pattern: string): boolean {
  return globToRegex(pattern).test(text);
}

function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (ch === '*') {
      re += '[^/]*';
      i++;
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (ch === '[') {
      const end = pattern.indexOf(']', i);
      if (end !== -1) {
        re += pattern.slice(i, end + 1);
        i = end + 1;
      } else {
        re += '\\[';
        i++;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
      re += '\\' + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}
