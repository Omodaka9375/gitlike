// ---------------------------------------------------------------------------
// GitLike CLI — Entry Point
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import { browserLogin, tokenLogin, logout, authStatus } from './auth.js';
import { cloneRepo } from './clone.js';
import { initRepo } from './init.js';
import { pullRepo } from './pull.js';
import { pushRepo } from './push.js';
import {
  showLog,
  showStatus,
  showDiff,
  listBranches,
  createNewBranch,
  switchBranch,
} from './commands.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('gitlike')
  .description('GitLike — decentralized version control on IPFS')
  .version(VERSION);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const auth = program.command('auth').description('Manage authentication');

auth
  .command('login')
  .description('Authenticate via browser (SIWE)')
  .option('--token <token>', 'Use a token directly instead of browser flow')
  .option('--address <address>', 'Wallet address (required with --token)')
  .action(async (opts: { token?: string; address?: string }) => {
    if (opts.token) {
      if (!opts.address) {
        console.error('--address is required when using --token');
        process.exit(1);
      }
      tokenLogin(opts.token, opts.address);
    } else {
      await browserLogin();
    }
  });

auth
  .command('logout')
  .description('Clear stored credentials')
  .action(() => logout());

auth
  .command('status')
  .description('Show current auth status')
  .action(() => authStatus());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

program
  .command('init <name>')
  .description('Create a new repo and initialise the current directory')
  .option('-d, --description <desc>', 'Repo description')
  .option('--private', 'Create a private repo')
  .option('--license <id>', 'License identifier (e.g. MIT, Apache-2.0)')
  .action(
    async (name: string, opts: { description?: string; private?: boolean; license?: string }) => {
      await initRepo(name, {
        description: opts.description,
        visibility: opts.private ? 'private' : 'public',
        license: opts.license,
      });
    },
  );

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

program
  .command('clone <groupId>')
  .description('Clone a repo by group ID')
  .argument('[directory]', 'Target directory')
  .action(async (groupId: string, directory?: string) => {
    await cloneRepo(groupId, directory);
  });

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

program
  .command('pull')
  .description('Pull latest changes from remote')
  .action(async () => {
    await pullRepo();
  });

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

program
  .command('push')
  .description('Push local changes to remote')
  .requiredOption('-m, --message <msg>', 'Commit message')
  .option('--files <paths...>', 'Specific files to push (default: all)')
  .action(async (opts: { message: string; files?: string[] }) => {
    await pushRepo(opts.message, opts.files);
  });

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

program
  .command('log')
  .description('Show commit history')
  .option('-n, --count <n>', 'Number of commits to show', '20')
  .action(async (opts: { count: string }) => {
    await showLog(parseInt(opts.count, 10));
  });

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Show repo status')
  .action(async () => {
    await showStatus();
  });

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

program
  .command('diff')
  .description('Show changed files compared to last push/pull')
  .action(() => {
    showDiff();
  });

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

const branch = program.command('branch').description('Manage branches');

branch
  .command('list')
  .description('List remote branches')
  .action(async () => {
    await listBranches();
  });

branch
  .command('create <name>')
  .description('Create a new branch from current branch')
  .action(async (name: string) => {
    await createNewBranch(name);
  });

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

program
  .command('switch <branch>')
  .description('Switch to a different branch')
  .action(async (branchName: string) => {
    await switchBranch(branchName);
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse();
