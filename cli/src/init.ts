// ---------------------------------------------------------------------------
// GitLike CLI — Init Command
// Creates a new repo and initialises the current directory.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import { requireAuth, writeRepoState, findRepoRoot, writeLocalIndex } from './config.js';
import { createRepo } from './api.js';

type InitOptions = {
  description?: string;
  visibility?: 'public' | 'private';
  license?: string;
};

/** Create a new repo on the remote and write local .gitlike state. */
export async function initRepo(name: string, opts: InitOptions = {}): Promise<void> {
  requireAuth();

  // Guard: don't init inside an existing repo
  if (findRepoRoot()) {
    console.error('Already inside a GitLike repo. Aborting.');
    process.exit(1);
  }

  console.log(`Creating repo "${name}"...`);

  const { groupId, commitCid } = await createRepo(
    name,
    opts.description,
    opts.visibility,
    opts.license,
  );

  // Write local state
  writeRepoState({
    groupId,
    name,
    branch: 'main',
    head: commitCid,
  });

  writeLocalIndex({});

  // Create .gitlikeignore with sensible defaults if it doesn't exist
  if (!fs.existsSync('.gitlikeignore')) {
    fs.writeFileSync(
      '.gitlikeignore',
      ['node_modules/', '.git/', 'dist/', '.env', '.env.*', ''].join('\n'),
    );
  }

  console.log(`✓ Repo created: ${name} (${groupId.slice(0, 12)}…)`);
  console.log(`  Branch: main`);
  console.log(`  HEAD:   ${commitCid.slice(0, 12)}…`);
}
