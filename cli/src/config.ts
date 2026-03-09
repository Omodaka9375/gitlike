// ---------------------------------------------------------------------------
// GitLike CLI — Configuration
// Global auth (~/.gitlike/config.json) and local repo state (.gitlike/repo.json).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_DIR = path.join(os.homedir(), '.gitlike');
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, 'config.json');
const LOCAL_DIR = '.gitlike';
const LOCAL_CONFIG = 'repo.json';
const DEFAULT_API = 'https://gitlike.dev';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlobalConfig = {
  apiUrl: string;
  token: string;
  address: string;
};

export type RepoState = {
  groupId: string;
  name: string;
  branch: string;
  head: string;
};

// ---------------------------------------------------------------------------
// Global config
// ---------------------------------------------------------------------------

export function readGlobalConfig(): GlobalConfig {
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<GlobalConfig>;
    return {
      apiUrl: parsed.apiUrl || DEFAULT_API,
      token: parsed.token || '',
      address: parsed.address || '',
    };
  } catch {
    return { apiUrl: DEFAULT_API, token: '', address: '' };
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG, JSON.stringify(config, null, 2) + '\n');
}

export function clearGlobalConfig(): void {
  try {
    fs.unlinkSync(GLOBAL_CONFIG);
  } catch {
    // Already gone
  }
}

export function isAuthenticated(): boolean {
  return !!readGlobalConfig().token;
}

export function requireAuth(): GlobalConfig {
  const config = readGlobalConfig();
  if (!config.token) {
    console.error('Not authenticated. Run: gitlike auth login');
    process.exit(1);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Local repo state
// ---------------------------------------------------------------------------

/** Find .gitlike/ by walking up from cwd. */
export function findRepoRoot(): string | null {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, LOCAL_DIR, LOCAL_CONFIG))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readRepoState(root?: string): RepoState | null {
  const repoRoot = root ?? findRepoRoot();
  if (!repoRoot) return null;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, LOCAL_DIR, LOCAL_CONFIG), 'utf-8');
    return JSON.parse(raw) as RepoState;
  } catch {
    return null;
  }
}

export function writeRepoState(state: RepoState, root?: string): void {
  const repoRoot = root ?? process.cwd();
  const dir = path.join(repoRoot, LOCAL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, LOCAL_CONFIG), JSON.stringify(state, null, 2) + '\n');
}

export function requireRepo(): { root: string; state: RepoState } {
  const root = findRepoRoot();
  if (!root) {
    console.error('Not inside a GitLike repo. Run: gitlike clone <groupId>');
    process.exit(1);
  }
  const state = readRepoState(root)!;
  return { root, state };
}

// ---------------------------------------------------------------------------
// Local index — tracks { path → cid } for change detection
// ---------------------------------------------------------------------------

export type LocalIndex = Record<string, string>;

export function readLocalIndex(root?: string): LocalIndex {
  const repoRoot = root ?? findRepoRoot();
  if (!repoRoot) return {};
  try {
    const raw = fs.readFileSync(path.join(repoRoot, LOCAL_DIR, 'index.json'), 'utf-8');
    return JSON.parse(raw) as LocalIndex;
  } catch {
    return {};
  }
}

export function writeLocalIndex(index: LocalIndex, root?: string): void {
  const repoRoot = root ?? process.cwd();
  const dir = path.join(repoRoot, LOCAL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}
