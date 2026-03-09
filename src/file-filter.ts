// ---------------------------------------------------------------------------
// GitLike — File Filter
// Skips dot-directories and respects .gitignore patterns.
// ---------------------------------------------------------------------------

/** Default paths always ignored (case-insensitive match on filename). */
const ALWAYS_IGNORED = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Check if a file path should be ignored. */
export function shouldIgnore(path: string, gitignorePatterns: string[] = []): boolean {
  const segments = path.split('/');

  // Skip files inside dot-directories (e.g. .git/, .vscode/, .idea/)
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].startsWith('.')) return true;
  }

  // Skip always-ignored files
  const filename = segments[segments.length - 1].toLowerCase();
  if (ALWAYS_IGNORED.has(filename)) return true;

  // Check .gitignore patterns
  if (gitignorePatterns.length > 0 && matchesGitignore(path, gitignorePatterns)) {
    return true;
  }

  return false;
}

/** Filter a list of file paths, returning only those that should be kept. */
export function filterPaths(paths: string[], gitignorePatterns: string[] = []): string[] {
  return paths.filter((p) => !shouldIgnore(p, gitignorePatterns));
}

/**
 * Parse a .gitignore file into pattern strings.
 * Strips comments, blank lines, and trailing whitespace.
 */
export function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Check if a path matches any .gitignore pattern.
 * Supports: wildcards (*), directory patterns (trailing /), double-star (**),
 * negation (!) inverts the result for that pattern.
 */
function matchesGitignore(filePath: string, patterns: string[]): boolean {
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

/** Test a single gitignore pattern against a file path. */
function patternMatches(filePath: string, pattern: string): boolean {
  // Directory-only pattern (trailing /)
  const dirOnly = pattern.endsWith('/');
  const clean = dirOnly ? pattern.slice(0, -1) : pattern;

  // If pattern contains a slash (not trailing), it's anchored to root
  const anchored = clean.includes('/');

  if (anchored) {
    const p = clean.startsWith('/') ? clean.slice(1) : clean;
    if (dirOnly) {
      // Match any file under that directory
      return filePath.startsWith(p + '/') || filePath === p;
    }
    return globMatch(filePath, p);
  }

  // Unanchored — match against filename or any path suffix
  const segments = filePath.split('/');
  if (dirOnly) {
    // Match directory names within the path
    return segments.slice(0, -1).some((s) => globMatch(s, clean));
  }

  // Match filename or full path
  return globMatch(segments[segments.length - 1], clean) || globMatch(filePath, '**/' + clean);
}

/** Simple glob matcher supporting *, ?, and **. */
function globMatch(text: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(text);
}

/** Convert a glob pattern to a RegExp. */
function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches any number of directories
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i++; // skip trailing slash after **
    } else if (ch === '*') {
      re += '[^/]*';
      i++;
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (ch === '[') {
      // Character class — pass through until ]
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
