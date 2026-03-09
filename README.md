# GitLike

**Decentralized version control powered by IPFS and Ethereum.**

GitLike is a fully browser-based, decentralized version control system. Repositories are stored as content-addressed objects on [IPFS](https://ipfs.io/) (via [Pinata](https://pinata.cloud/)), authenticated with Ethereum wallets (SIWE), and served through a [Cloudflare Worker](https://workers.cloudflare.com/) backend.

**Live at [gitlike.dev](https://gitlike.dev)**

---

## Why GitLike?

Git changed how developers collaborate, but the platforms built around it — GitHub, GitLab — are centralized. Your code lives on someone else's servers under their terms.

GitLike takes a different approach:

- **Content-addressed storage** — Every file, tree, and commit is an immutable IPFS object identified by its CID. Data integrity is guaranteed by the protocol itself.
- **Wallet-based identity** — No usernames, passwords, or email signups. Connect your Ethereum wallet, sign in with SIWE, and start pushing code.
- **No vendor lock-in** — Your data lives on IPFS. You can access it from any gateway, any tool, at any time.
- **CLI & browser** — Use the full web UI or the `gitlike` CLI to push, pull, and manage repos from your terminal.

---

## Features

### Repository Management
- **Create repos** — Initialize with a name and description, signed by your wallet
- **GitHub import** — Import existing GitHub repositories (parallel uploads, truncation handling)
- **Fork repos** — One-click fork with full history
- **Repo settings** — Rename, update description, manage write access
- **Delete repos** — Owner-only destructive action with confirmation
- **URL slugs** — Human-readable repo URLs resolved via slug index

### Branching & Merging
- **Create branches** — Branch from any existing branch
- **Delete branches** — Clean up merged branches
- **Merge branches** — Three-way merge with automatic tree reconciliation
- **Conflict detection** — Detects conflicting changes and reports them before merge

### Commits & History
- **Upload & commit files** — Browser-based file upload with commit messages
- **In-browser file editing** — Edit files directly and commit changes
- **Delete files** — Remove files with a deletion commit
- **Commit history** — Walk the DAG with full parent/child traversal
- **Commit detail view** — View metadata, parent links, and diffs for any commit
- **Commit signatures** — EIP-191 signatures verified in-browser via Pinata Signatures API

### Pull Requests
- **Create PRs** — Propose merging one branch into another
- **PR list view** — See all open, merged, and closed PRs
- **PR detail view** — Full diff between source and target branches
- **Merge & close** — Merge the PR and update its status
- **Close without merge** — Reject a PR

### Tags & Releases
- **Create tags** — Tag any commit (e.g. `v1.0.0`)
- **Tag display** — Tags shown in repo navigation

### Client-Side Encryption
- **AES-256-GCM** — All content encrypted in the browser before upload; decrypted on read
- **ECDH key exchange** — Repo keys derived from owner/collaborator wallet keypairs
- **HKDF key derivation** — Cryptographically strong key stretching
- **AES-KW key wrapping** — Repo key wrapped per-collaborator for access control
- **Encrypted file names** — Optional filename encryption for maximum privacy
- **Streaming chunked encryption** — Large files encrypted in chunks to stay memory-efficient
- **Key rotation** — Rotate repo keys with automatic re-wrapping for all collaborators
- **Session key cache** — Unwrapped keys cached in sessionStorage for performance
- **Public key storage** — Wallet public keys stored server-side for key exchange

### Diff Viewer
- **Tree-level diffing** — Compare two tree snapshots to find added, modified, and removed files
- **Inline diff display** — Color-coded additions (green) and removals (red)
- **Diff stats** — Summary counts of added/modified/removed files

### File Browsing
- **File tree** — Navigate directories with icons, CIDs, and file sizes
- **File viewer** — Syntax-highlighted code with line numbers (Prism.js — 10 language packs)
- **Binary detection** — Null-byte scan with image preview for image files
- **README rendering** — Markdown READMEs rendered automatically below the file tree
- **README previews** — First ~160 chars of each repo's README shown on home cards
- **File search** — Fuzzy search across all file paths in the repo
- **Code search** — Full-text search across file contents (`GET /api/repos/:id/search`)
- **File history** — View commit history filtered to a specific file path
- **Breadcrumb navigation** — Always know where you are in the tree
- **Copy-to-clipboard** — One-click CID copying in file viewer and tree table

### Download & Export
- **ZIP download** — Download any branch as a `.zip` archive (built with [fflate](https://github.com/101arrowz/fflate))
- **Archive API** — `GET /api/repos/:id/archive/:branch` returns a ZIP for CLI usage:
  ```
  curl -o repo.zip https://gitlike.dev/api/repos/<groupId>/archive/main
  ```

### Access Control
- **Owner/Writer roles** — Owners can manage settings and writers; writers can push commits
- **Private repos** — Repos can be set to private; only owners and writers can see them
- **Branch protection** — Lock branches to prevent direct commits and merges; configurable in repo settings
- **Agent delegation** — Delegate scoped permissions (specific actions + path globs) to agent wallets with expiry
- **Platform access control** — Admin/writer/visitor roles at the platform level; admins can restrict repo creation to approved writers
- **Optimistic concurrency** — Manifest version checks prevent lost updates on concurrent writes
- **Upload limits** — 10 MB max body size, 200 files per commit

### GitLike Pages (Static Site Hosting)
- **Publish repos as websites** — Enable Pages in repo settings to host a static site directly from your repo
- **Custom slugs** — Sites served at `app.gitlike.dev/<slug>` with configurable URL slugs
- **Branch selection** — Choose which branch to deploy (defaults to the default branch)
- **Automatic MIME handling** — 45+ file extensions served with correct content types
- **Directory indexes** — Automatic `index.html` fallback for directory paths
- **Custom 404 pages** — Drop a `404.html` in your repo root for branded error pages
- **Immutable caching** — Files cached aggressively via content-addressed IPFS CIDs

### Projects
- **Group repos** — Organize related repositories into named project collections
- **Project slugs** — Human-readable project URLs
- **Visibility** — Public or private projects
- **CRUD** — Create, update, and delete projects; owner or admin only
- **Reverse lookup** — See which projects a repo belongs to

### User Profiles & Identity
- **Profile pages** — View any address's owned repositories at `#/user/<address>`
- **Profile pictures** — Upload a PFP displayed across the platform
- **Wallet aliases** — Set a human-readable display name for your wallet address
- **Bio** — Short 160-character bio displayed on profile pages
- **Follow creators** — Follow wallet addresses to see their repos in a dedicated feed on the home page
- **Followers/following** — View follower and following lists for any address
- **Activity feed** — Recent commits across all repos on the landing page
- **Following feed** — Aggregated repos from creators you follow
- **Contribution graph** — GitHub-style heatmap of commit activity over the past year
- **Star repos** — Star/unstar repos; view starred repos on your profile

### Identity & Auth
- **SIWE (Sign-In with Ethereum)** — Session-based auth, no passwords
- **MetaMask / injected provider** — Works with any EIP-1193 wallet
- **Session management** — Token stored in sessionStorage, auto-cleared on disconnect
- **Address avatar** — Unique gradient avatar derived from your wallet address

### Sharing & Discovery
- **Dynamic OG meta tags** — Repo share links generate rich previews (title, description, stats) on social platforms
- **For Humans page** — Visual explainer of how GitLike works (`#/how-it-works`)
- **For Agents page** — Machine-readable API docs for LLMs and automation (`#/for-agents`)

### Federation
- **Peer discovery** — Register other GitLike instances as federated peers via `/.well-known/gitlike.json`
- **Automatic sync** — Periodic sync fetches peer status, metadata, and public repo lists
- **Federated repo browsing** — View repos from federated instances in the UI
- **Admin management** — Register, remove, and manually sync peers (admin only)

### Storage Providers
- **Provider abstraction** — Pluggable storage backend interface (`StorageProvider`)
- **Pinata** — Default IPFS storage via Pinata SDK (groups, presigned uploads, signatures)
- **Filebase** — Alternative S3-compatible IPFS storage backend
- **Mirrored writes** — When both providers are configured, writes are mirrored to Filebase for redundancy
- **Configurable** — Set `STORAGE_PROVIDER` env var to choose backend

### CLI
- **Cross-platform CLI** — `gitlike` command for clone, push, pull, log, status, branch, and switch
- **Browser-based auth** — `gitlike auth login` opens your browser for SIWE signing, then stores the token locally
- **Manual token auth** — `gitlike auth login --token <T> --address <A>` for headless/CI environments
- **Selective push** — Push all files or specify individual paths with `--files`
- **npm installable** — `npm install -g gitlike-cli` (see [docs/cli.md](docs/cli.md))

### UI & Experience
- **Custom modal dialogs** — All browser dialogs (alert, confirm, prompt) replaced with styled, Promise-based modals
- **Dark/light theme** — Toggle between themes; persisted in localStorage
- **Keyboard shortcuts** — `t`/`/` file search, `Escape` close modals, `g h` home, `g c` commits
- **Contributor stats** — Top 10 contributors with bar chart on repo page
- **.gitignore filtering** — Uploaded files are filtered against `.gitignore` rules automatically
- **Share button** — Share repos via Web Share API with clipboard fallback
- **RSS/Atom feed** — Subscribe to repo activity at `/api/repos/:id/feed`
- **Deep health check** — `GET /api/health/deep` verifies KV + storage provider connectivity
- **Client error reporting** — Frontend errors reported to `POST /api/errors` for monitoring

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Browser (SPA)                    │
│                                                   │
│   Vanilla TS  ─  esbuild  ─  hash-based router   │
│   Wallet (viem)  ─  SIWE  ─  Pinata Gateway      │
└───────────────────────┬──────────────────────────┘
                        │ /api/*
┌───────────────────────▼──────────────────────────┐
│             Cloudflare Worker (Hono)              │
│                                                   │
│   Auth (SIWE verify)  ─  Rate limiting            │
│   CORS  ─  Structured logging                     │
│   Input validation  ─  Security headers           │
│   Dynamic OG meta ─ Alias resolution              │
├───────────────────────────────────────────────────┤
│   Durable Object: RepoLock                        │
│   Serialized mutations (commit, merge, branch,    │
│   tag, PR, settings, delegation, pages)           │
├───────────────────────────────────────────────────┤
│   KV: Sessions + manifests + pages slugs          │
└───────────────────────┬──────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────┐
│    Storage Provider (IPFS)                │
│                                                   │
│   Pinata (default) ─ Filebase (alt/mirror)        │
│   Groups ─ Presigned uploads ─ JSON pinning       │
│   Signatures API  ─  Dedicated gateway            │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│        Pages Worker (app.gitlike.dev)             │
│                                                   │
│   Slug → KV → manifest → IPFS tree → serve       │
│   MIME detection ─ directory indexes ─ 404s       │
└──────────────────────────────────────────────────┘
```

### Data Model

All objects are JSON pinned to IPFS:

- **Tree** — Directory listing: `{ entries: [{ name, cid, kind, size }] }`
- **Commit** — Snapshot pointer: `{ tree, parents[], author, timestamp, message }`
- **Manifest** — Repo metadata: `{ name, branches, tags, acl, pullRequests[], pages?, encryption?, keyBundle?, version }`
- **Delegation** — Scoped agent permission with EIP-191 signature
- **Project** — Collection of repos: `{ name, description, repos[], owner, visibility }`

Reads go directly to the IPFS gateway (content-addressed = cacheable forever). Writes go through the Worker, which validates auth/ACL, then routes mutations through a Durable Object for serialized execution.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- A [Pinata](https://pinata.cloud/) account with API JWT
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI (installed as devDependency)

### Setup

```bash
# Clone and install
gitlike clone <repo-url>
cd GitLike
pnpm install

# Configure Cloudflare
wrangler login
wrangler kv namespace create SESSIONS
# → Copy the namespace ID into wrangler.toml

# Set your Pinata JWT as a secret
wrangler secret put PINATA_JWT

# Update wrangler.toml with your Pinata gateway domain
# PINATA_GATEWAY = "your-gateway.mypinata.cloud"
```

### Development

```bash
# Start local dev server (builds frontend + runs Worker locally)
pnpm dev

# Watch frontend only
pnpm dev:frontend
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Build frontend + start Wrangler dev server |
| `pnpm dev:frontend` | Watch-mode frontend build |
| `pnpm build` | Production frontend build |
| `pnpm check` | TypeScript type-check (frontend + worker + pages worker) |
| `pnpm test` | Run test suite (345 tests across 25 files) |
| `pnpm format` | Format all TypeScript with Prettier |
| `pnpm deploy` | Build + deploy main worker to Cloudflare Workers |
| `pnpm deploy:pages` | Deploy the Pages worker to Cloudflare Workers |

### Deploy

```bash
pnpm run deploy
```

---

## API Reference

All endpoints are under `/api`. Reads are public; writes require a valid SIWE session token in the `Authorization` header.

### Auth
- `POST /api/auth/nonce` — Get a SIWE nonce
- `POST /api/auth/verify` — Verify SIWE signature, returns session token
- `POST /api/auth/logout` — Destroy session

### Repos
- `GET /api/repos` — List repos (paginated: `?limit=20&offset=0`)
- `POST /api/repos` — Create repo `{ name, description }`
- `DELETE /api/repos/:id` — Delete repo (owner only)

### Commits & Files
- `POST /api/repos/:id/presign` — Get presigned upload URL
- `POST /api/repos/:id/commit` — Create commit `{ branch, message, files[] }`

### Branches
- `POST /api/repos/:id/branch` — Create branch `{ name, from }`
- `DELETE /api/repos/:id/branch/:name` — Delete branch

### Merge
- `POST /api/repos/:id/merge` — Merge `{ source, target, message }`

### Tags
- `POST /api/repos/:id/tag/:name` — Create tag `{ target }`
- `DELETE /api/repos/:id/tag/:name` — Delete tag

### Pull Requests
- `POST /api/repos/:id/pr` — Create PR `{ title, description, sourceBranch, targetBranch }`
- `PATCH /api/repos/:id/pr/:cid` — Update PR status `{ status }`
- `GET /api/repos/:id/prs` — List PRs

### Settings & ACL
- `POST /api/repos/:id/settings` — Update settings `{ name, description, writers, protectedBranches, encryption?, keyBundle? }`
- `POST /api/repos/:id/pages` — Toggle Pages hosting `{ enabled, branch?, slug? }`
- `POST /api/repos/:id/delegation` — Create agent delegation
- `DELETE /api/repos/:id/delegation/:agent` — Revoke delegation

### Download
- `GET /api/repos/:id/archive/:branch` — Download branch as ZIP

### History
- `GET /api/repos/:id/commits/:branch` — Paginated commit history

### Search
- `GET /api/repos/:id/search?q=<query>&branch=<branch>` — Full-text code search

### Stars
- `POST /api/repos/:id/star` — Star a repo
- `DELETE /api/repos/:id/star` — Unstar a repo
- `GET /api/repos/:id/stars` — Get star count and whether caller has starred
- `GET /api/user/:address/starred` — List repos starred by an address

### Identity
- `GET /api/alias/:address` — Get alias, PFP, and bio for an address
- `PUT /api/alias` — Set wallet alias `{ alias }`
- `PUT /api/bio` — Set bio `{ bio }` (max 160 chars)
- `PUT /api/pfp` — Upload profile picture `{ url }` or resolve ENS `{ ens: true }`
- `GET /api/avatar/:address` — Privacy-preserving avatar proxy
- `GET /api/pubkey/:address` — Get stored public key for encryption
- `PUT /api/pubkey` — Store public key `{ pubkey }`

### Social
- `POST /api/follow` — Follow an address `{ address }`
- `DELETE /api/follow/:address` — Unfollow an address
- `GET /api/following/:address` — List addresses a user follows
- `GET /api/followers/:address` — List followers of an address
- `GET /api/user/:address/contributions` — Contribution heatmap data (last 365 days)

### Projects
- `GET /api/projects` — List projects (optional `?owner=` filter)
- `GET /api/projects/:id` — Get a project
- `GET /api/projects/resolve/:slug` — Resolve project slug to ID
- `POST /api/projects` — Create project `{ name, description, repos[], visibility? }`
- `PATCH /api/projects/:id` — Update project
- `DELETE /api/projects/:id` — Delete project
- `GET /api/repos/:id/projects` — List projects containing a repo

### Platform
- `GET /api/platform/settings` — Get platform settings and caller's role
- `PUT /api/platform/settings` — Update platform settings (admin only)
- `GET /api/platform/usage` — Storage usage stats (admin only)

### Federation
- `GET /api/federation/peers` — List federated peers
- `POST /api/federation/register` — Register a peer `{ domain }` (admin only)
- `DELETE /api/federation/peers/:domain` — Remove a peer (admin only)
- `POST /api/federation/sync` — Manually trigger peer sync (admin only)
- `GET /.well-known/gitlike.json` — Federation discovery endpoint

### Feed
- `GET /api/repos/:id/feed` — Atom XML feed of recent commits
- `GET /api/user/:address/feed` — Atom feed of a creator's repos

### Proxy
- `GET /api/ipfs/:cid` — IPFS gateway proxy (avoids restricted gateway 403s)

### Monitoring
- `GET /api/health` — Basic health check
- `GET /api/health/deep` — Deep health check (KV + storage provider)
- `POST /api/errors` — Client-side error reporting

---

## Comparison with Similar Projects

### GitLike vs Radicle

[Radicle](https://radicle.xyz/) is a peer-to-peer code collaboration stack built on Git with a custom gossip protocol.

| Aspect | GitLike | Radicle |
|--------|---------|---------|
| **Storage** | IPFS (Pinata) | Git (peer-to-peer replication) |
| **Identity** | Ethereum wallets (SIWE) | Ed25519 keypairs (DID) |
| **Access** | Browser-only, zero install | Requires CLI + local node |
| **Platform** | Any browser, any OS | Linux/macOS (Windows support partial as of v1.3) |
| **Architecture** | Client-server (CF Worker + IPFS) | Fully peer-to-peer |
| **Social features** | PRs, activity feed | Issues, patches, discussions (COBs) |
| **Offline support** | No (requires network) | Yes (local-first) |
| **Maturity** | Early-stage | Production (v1.3+, used for self-hosting) |

**When to choose Radicle:** You want true peer-to-peer sovereignty, local-first workflows, and don't mind running a node.

**When to choose GitLike:** You want instant browser-based access with wallet auth, IPFS-native content addressing, and zero infrastructure to manage.

### GitLike vs Gitopia

[Gitopia](https://gitopia.com/) is a blockchain-native code collaboration platform built on Cosmos SDK.

| Aspect | GitLike | Gitopia |
|--------|---------|---------|
| **Storage** | IPFS (Pinata) | Blockchain (Cosmos) + Arweave |
| **Identity** | Ethereum wallets | Cosmos wallets (LORE token) |
| **Cost** | Free (Pinata free tier) | Gas fees for every action |
| **Token required** | No | Yes (LORE token) |
| **Governance** | Owner/writer ACL | DAO governance, proposals |
| **Incentives** | None | Bounties, staking rewards |
| **Speed** | Near-instant (edge Workers) | Block confirmation times |
| **Complexity** | Minimal (IPFS + Worker) | Full blockchain stack |

**When to choose Gitopia:** You want DAO governance, on-chain incentives, and blockchain-native code management.

**When to choose GitLike:** You want a lightweight, fast, free-to-use platform without tokens or gas fees.

### GitLike vs GitHub/GitLab

| Aspect | GitLike | GitHub/GitLab |
|--------|---------|---------------|
| **Decentralized** | Yes (IPFS) | No (centralized servers) |
| **Identity** | Wallet-based, pseudonymous | Email/password accounts |
| **Data ownership** | You own your CIDs | Platform owns your data |
| **Censorship** | Resistant (content-addressed) | Subject to platform policies |
| **Features** | Core VCS + PRs | Full DevOps suite (CI/CD, issues, wikis, etc.) |
| **Ecosystem** | Standalone | Massive (Actions, Pages, Packages, etc.) |
| **Maturity** | Early-stage | Industry standard |

**When to choose GitHub/GitLab:** You need the full DevOps ecosystem, CI/CD, project management, and team tooling.

**When to choose GitLike:** You want censorship-resistant, wallet-authenticated version control where you truly own your code.

---

## Tech Stack

- **Frontend:** Vanilla TypeScript SPA, esbuild, hash-based router
- **Backend:** Cloudflare Workers, Hono framework, Durable Objects
- **CLI:** Node.js, Commander, esbuild bundle (`cli/`)
- **Storage:** IPFS via Pinata SDK (default) or Filebase (S3-compatible), with optional mirrored writes
- **Encryption:** Web Crypto API (AES-256-GCM, ECDH, HKDF, AES-KW)
- **Auth:** SIWE (Sign-In with Ethereum) via viem
- **Wallet:** MetaMask / WalletConnect / any EIP-1193 injected provider
- **Testing:** Vitest (345 tests across 25 test files)
- **Syntax highlighting:** Prism.js (CDN, 10 language packs)
- **Formatting:** Prettier
- **Compression:** fflate (ZIP archives)

---

## Project Structure

```
GitLike/
├── public/              # Static assets served by CF Workers
│   └── index.html       # SPA shell + all CSS
├── src/                 # Frontend source
│   ├── main.ts          # Entry point, router init, keyboard shortcuts
│   ├── api.ts           # API client (Worker + gateway)
│   ├── wallet.ts        # Wallet connection + SIWE
│   ├── signing.ts       # Commit signature verification
│   ├── encryption.ts    # Client-side encryption (AES-256-GCM, ECDH, key bundles)
│   ├── config.ts        # Runtime configuration
│   ├── types.ts         # Core data model types
│   ├── prism.ts         # Prism.js language loading
│   ├── global.d.ts      # Ambient type declarations (Prism, etc.)
│   ├── file-filter.ts   # .gitignore rule matching
│   └── ui/
│       ├── router.ts    # Hash-based router
│       ├── dom.ts       # DOM helpers (el, render, spinner)
│       ├── views.ts     # View dispatch + shared components
│       ├── home.ts      # Landing page (activity feed, repo list, marquee)
│       ├── repo-view.ts # Repo detail (tree, file viewer, settings, encryption)
│       ├── commit-detail.ts # Commit detail + diff view
│       ├── pr-views.ts  # Pull request list + detail views
│       ├── user-profile.ts # User profile page
│       ├── project-list.ts # Project listing page
│       ├── project-detail.ts # Project detail page
│       ├── starred-repos.ts # Starred repos page
│       ├── file-history.ts # File-level commit history
│       ├── contribution-graph.ts # GitHub-style heatmap
│       ├── info-pages.ts # How-it-works + for-agents pages
│       ├── wallet-bar.ts # Persistent wallet bar + theme toggle
│       ├── dialogs.ts   # Custom modal dialogs (alert, confirm, prompt, select)
│       ├── platform-settings.ts # Platform admin settings modal
│       ├── user-identity.ts # PFP + alias rendering
│       ├── shared.ts    # Shared UI utilities
│       ├── diff.ts      # Tree diffing engine
│       └── markdown.ts  # Markdown renderer
├── worker/              # Cloudflare Worker backend
│   ├── index.ts         # Hono app entry point
│   ├── operations.ts    # API route handlers (repos, commits, branches, etc.)
│   ├── mutations.ts     # Serialized repo mutations (via DO)
│   ├── ipfs.ts          # IPFS read/write helpers (fetch, pin, walk history)
│   ├── storage.ts       # Storage provider abstraction + factory
│   ├── storage-pinata.ts # Pinata storage implementation
│   ├── storage-filebase.ts # Filebase (S3) storage implementation
│   ├── tree-builder.ts  # Tree construction from staged files
│   ├── auth.ts          # SIWE nonce/verify/logout + pubkey extraction
│   ├── middleware.ts     # Auth guard, rate limiting, security headers
│   ├── validation.ts    # Input validation (including encryption fields)
│   ├── repo-lock.ts     # Durable Object for serialized repo writes
│   ├── social-lock.ts   # Durable Object for serialized social mutations
│   ├── repo-index.ts    # KV-based repo index + slug registry
│   ├── projects.ts      # Project CRUD + slug management
│   ├── federation.ts    # Federation peer discovery, registration, sync
│   ├── platform.ts      # Platform-level access control (admin/writer/visitor)
│   ├── og-image.ts      # Dynamic OG image generator (SVG)
│   ├── licenses.ts      # License templates (NOL, MIT, Apache, GPL, BSD)
│   ├── migrations.ts    # Data migration helpers
│   ├── logger.ts        # Structured request logging
│   ├── siwe-parser.ts   # SIWE message parser
│   ├── utils.ts         # Shared helpers (errorMsg, isOwnerOrWriter)
│   └── env.ts           # Worker env type bindings
├── worker-pages/        # GitLike Pages static site worker
│   ├── index.ts         # Pages worker entry (slug → IPFS → serve)
│   ├── mime.ts          # MIME type detection (45+ extensions)
│   └── tsconfig.json    # TypeScript config for pages worker
├── cli/                 # GitLike CLI (Node.js)
│   ├── src/index.ts     # Entry point (Commander wiring)
│   ├── src/config.ts    # Global config + local repo state
│   ├── src/api.ts       # HTTP client for Worker API
│   ├── src/auth.ts      # Browser-based SIWE auth flow
│   ├── src/clone.ts     # Clone command
│   ├── src/pull.ts      # Pull command
│   ├── src/push.ts      # Push command
│   ├── src/commands.ts  # Log, status, branch, switch commands
│   ├── build.mjs        # esbuild bundler
│   └── package.json
├── tests/               # Test suite (345 tests, 25 files)
├── docs/
│   ├── cli.md           # CLI installation, usage & npm publishing guide
│   ├── backup.md        # Backup & disaster recovery guide
│   ├── kv-keys.md       # KV namespace key reference
│   ├── monitoring.md    # Monitoring & observability guide
│   └── storage-providers.md # Storage provider configuration guide
├── wrangler.toml        # Main Cloudflare Worker config
├── wrangler-pages.toml  # Pages Worker config (app.gitlike.dev)
└── package.json
```

---

## License

MIT
