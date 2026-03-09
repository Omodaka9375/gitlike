# GitLike CLI

Command-line interface for GitLike — clone, push, pull, and manage repos from any terminal.

## Installation

### From npm (once published)

```
npm install -g gitlike-cli
```

Or with pnpm:

```
pnpm add -g gitlike-cli
```

This installs the `gitlike` command globally.

### From source

```
git clone https://github.com/user/GitLike.git
cd GitLike/cli
pnpm install
pnpm build
```

The built binary is at `cli/bin/gitlike.mjs`. To make it available globally:

```
npm link
```

Or run it directly:

```
node cli/bin/gitlike.mjs <command>
```

### Requirements

- Node.js 20+
- A browser (for wallet-based authentication)

## Authentication

GitLike uses Ethereum wallet signatures (SIWE). The CLI opens your browser for signing, then stores the session token locally at `~/.gitlike/config.json`.

### Browser login (recommended)

```
gitlike auth login
```

Opens your default browser at `gitlike.dev/cli-auth`. Connect your wallet, sign the message, and the CLI receives the token automatically.

### Manual token login

If browser auth isn't possible (headless server, CI), provide a token directly:

```
gitlike auth login --token <TOKEN> --address <0xYOUR_ADDRESS>
```

### Check status

```
gitlike auth status
```

### Logout

```
gitlike auth logout
```

Clears stored credentials from `~/.gitlike/config.json`.

## Commands

### clone

Download a repo to a local directory.

```
gitlike clone <groupId> [directory]
```

- `groupId` — the repo's Pinata group UUID (visible in the URL on gitlike.dev)
- `directory` — optional target folder (defaults to the repo name)

Example:

```
gitlike clone a1b2c3d4-5678-90ab-cdef-1234567890ab my-project
```

### pull

Fetch latest changes from remote and update local files.

```
gitlike pull
```

Run from inside a cloned repo directory.

### push

Upload local changes and create a commit.

```
gitlike push -m "your commit message"
gitlike push -m "update readme" --files README.md src/index.ts
```

Options:
- `-m, --message <msg>` — commit message (required)
- `--files <paths...>` — specific files to push (default: all files)

### log

Show commit history for the current branch.

```
gitlike log
gitlike log -n 5
```

Options:
- `-n, --count <n>` — number of commits to show (default: 20)

### status

Show current repo info and sync state.

```
gitlike status
```

Displays repo name, group ID, branch, HEAD CID, and whether the remote has new commits.

### branch list

List all remote branches.

```
gitlike branch list
```

The current branch is marked with `*`.

### branch create

Create a new branch from the current branch.

```
gitlike branch create <name>
```

### switch

Switch to a different branch and download its files.

```
gitlike switch <branch>
```

## Typical Workflow

```
gitlike auth login
gitlike clone <groupId>
cd my-project

# make changes...

gitlike push -m "fix: resolve login bug"
gitlike log
gitlike status
```

## Configuration

### Global config

Stored at `~/.gitlike/config.json`:

```json
{
  "apiUrl": "https://gitlike.dev",
  "token": "<session-token>",
  "address": "0x..."
}
```

Sessions expire after 24 hours. Run `gitlike auth login` again to refresh.

### Repo state

Stored at `.gitlike/repo.json` in each cloned repo:

```json
{
  "groupId": "<uuid>",
  "name": "my-project",
  "branch": "main",
  "head": "<commit-cid>"
}
```

This file is created by `clone` and updated by `pull`, `push`, and `switch`.

## Publishing to npm

### Prerequisites

1. An npm account — sign up at [npmjs.com](https://www.npmjs.com/signup)
2. Log in from your terminal:

```
npm login
```

### Prepare the package

Make sure `cli/package.json` has the correct values:

- `name` — must be unique on npm (e.g. `gitlike-cli`). Check availability at `https://www.npmjs.com/package/gitlike-cli`.
- `version` — follow [semver](https://semver.org/). Start at `0.1.0` for the initial release.
- `description` — short summary shown on the npm page.
- `bin` — maps the `gitlike` command to the built file.
- `repository`, `homepage`, `bugs` — add these for npm page links:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/user/GitLike.git",
    "directory": "cli"
  },
  "homepage": "https://gitlike.dev",
  "bugs": "https://github.com/user/GitLike/issues"
}
```

### Add a .npmignore

Create `cli/.npmignore` to exclude source files from the published package:

```
src/
tsconfig.json
build.mjs
*.map
```

This ensures only `bin/`, `package.json`, `README.md`, and `LICENSE` are published.

### Build and publish

```
cd cli
pnpm build
npm publish
```

For scoped packages (e.g. `@yourorg/gitlike-cli`):

```
npm publish --access public
```

### Updating

1. Bump the version in `cli/package.json`
2. Rebuild: `pnpm build`
3. Publish: `npm publish`

Or use npm's version command:

```
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.1 → 0.2.0
npm version major   # 0.2.0 → 1.0.0
pnpm build
npm publish
```

### Verify

After publishing, verify the install works:

```
npm install -g gitlike-cli
gitlike --version
gitlike --help
```
