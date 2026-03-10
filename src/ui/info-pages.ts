// ---------------------------------------------------------------------------
// GitLike Info Pages (How It Works, For Agents, CLI Auth)
// ---------------------------------------------------------------------------

import { el, render } from './dom.js';
import { connectedAddress, connect, authenticateWithSiwe } from '../wallet.js';

// ---------------------------------------------------------------------------
// For Humans (How It Works)
// ---------------------------------------------------------------------------

/** Render the "For Humans" explainer page. */
export function renderHowItWorks(root: HTMLElement): void {
  const section = (icon: string, title: string, body: string) =>
    el('div', {
      cls: 'how-card fade-in',
      children: [
        el('div', { cls: 'how-icon', text: icon }),
        el('h3', { text: title }),
        el('p', { text: body }),
      ],
    });

  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'For Humans' }),
        el('p', {
          cls: 'subtitle',
          text: 'GitLike replaces centralized Git hosting with IPFS and SIWE auth',
        }),
      ],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        section(
          '1\uFE0F\u20E3',
          'Connect Your Wallet',
          'Sign in with any Ethereum wallet (MetaMask, WalletConnect, etc.) using Sign-In with Ethereum (SIWE). No email, no password \u2014 your wallet is your identity.',
        ),
        section(
          '2\uFE0F\u20E3',
          'Create a Repository',
          'Repos are stored on IPFS via your configured storage provider (Pinata or Filebase). Every file, tree, and commit is a content-addressed object \u2014 immutable and verifiable by its CID.',
        ),
        section(
          '3\uFE0F\u20E3',
          'Commit & Branch',
          'Upload files, edit in-browser, and commit with a message. Create branches, merge with three-way reconciliation, and open pull requests \u2014 all from your browser.',
        ),
        section(
          '4\uFE0F\u20E3',
          'Your Data, Your CIDs',
          'All data lives on IPFS. You can fetch any object from any gateway using its CID. No vendor lock-in \u2014 your code is always accessible.',
        ),
        section(
          '5\uFE0F\u20E3',
          'Customize Your Identity',
          'Set a display name, bio, and profile picture for your wallet. Use any image URL or pull your ENS avatar automatically.',
        ),
        section(
          '6\uFE0F\u20E3',
          'Host Static Sites',
          'Enable GitLike Pages on any repo to serve it as a static website at app.gitlike.dev/<slug>. Just add an index.html.',
        ),
        section(
          '7\uFE0F\u20E3',
          'Organize with Projects',
          'Group related repos into projects. Create, edit, and share project collections with a single link.',
        ),
        section(
          '8\uFE0F\u20E3',
          'Star, Follow & Contribute',
          'Star repos you like, follow developers, and track your contributions on a year-long heatmap on your profile page.',
        ),
      ],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Architecture' }),
        el('pre', {
          children: [
            el('code', {
              text:
                'Browser (Vanilla TS SPA)\n' +
                '  \u2502  Wallet (viem + WalletConnect) + SIWE auth\n' +
                '  \u2502  Reads \u2192 IPFS Gateway (cached by CID)\n' +
                '  \u2502  Writes \u2192 /api/*\n' +
                '  \u25BC\n' +
                'Cloudflare Worker (Hono)\n' +
                '  \u2502  Auth \u2022 Rate limiting \u2022 Validation\n' +
                '  \u2502  Durable Objects \u2192 serialized mutations\n' +
                '  \u2502  KV \u2192 sessions + manifest cache\n' +
                '  \u25BC\n' +
                'Storage Provider (Pinata or Filebase)\n' +
                '  Groups \u2022 Presigned uploads \u2022 JSON pinning\n' +
                '  Dedicated gateway \u2022 Optional dual-provider mirroring',
            }),
          ],
        }),
      ],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Data Model' }),
        el('div', {
          cls: 'how-grid',
          children: [
            section(
              '\uD83C\uDF33',
              'Tree',
              'Directory listing: entries with name, CID, kind (blob/tree), and size.',
            ),
            section(
              '\uD83D\uDCE6',
              'Commit',
              'Points to a tree, parent commits, author address, timestamp, and message.',
            ),
            section(
              '\uD83D\uDCC4',
              'Manifest',
              'Repo metadata: name, branches, tags, ACL (owners/developers), pull requests, and optional encryption config.',
            ),
            section(
              '\uD83D\uDD10',
              'Encryption',
              'Optional AES-256-GCM encryption with ECDH key exchange and per-collaborator key wrapping.',
            ),
            section(
              '\uD83D\uDD11',
              'Delegation',
              'Scoped agent permissions with EIP-191 signatures and expiry.',
            ),
          ],
        }),
      ],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Key Features' }),
        el('ul', {
          children: [
            el('li', { text: 'Syntax-highlighted file viewer (Prism.js, 10+ languages)' }),
            el('li', { text: 'Three-way merge with conflict detection' }),
            el('li', { text: 'Pull requests with full diff view' }),
            el('li', { text: 'Branch protection rules' }),
            el('li', { text: 'GitHub / GitLab import with parallel uploads' }),
            el('li', { text: 'ZIP download (browser + API)' }),
            el('li', { text: 'Full-text code search across file contents' }),
            el('li', { text: 'Atom feed per creator \u2014 follow a developer\u2019s repos' }),
            el('li', { text: 'EIP-191 commit signatures with in-browser verification' }),
            el('li', { text: 'Dark/light theme with keyboard shortcuts (t, /, g h, g c)' }),
            el('li', {
              text: 'GitLike Pages \u2014 host static sites directly from a repo branch',
            }),
            el('li', {
              text: 'User profiles \u2014 display names, bios, and profile pictures (ENS supported)',
            }),
            el('li', { text: 'Star repos and follow developers with contribution heatmaps' }),
            el('li', { text: 'Projects \u2014 group related repos into named collections' }),
            el('li', {
              text: 'Platform access control \u2014 admin, developer, and visitor roles',
            }),
            el('li', { text: 'Agent delegations \u2014 grant scoped write access to AI agents' }),
            el('li', { text: 'Private repos \u2014 visible only to owners and developers' }),
            el('li', {
              text: 'Client-side encryption \u2014 AES-256-GCM with ECDH key exchange and key rotation',
            }),
            el('li', {
              text: 'Pluggable storage \u2014 Pinata, Filebase, or dual-provider mirroring',
            }),
            el('li', {
              text: 'Federation \u2014 connect your instance to the decentralized network',
            }),
            el('li', { text: 'CLI \u2014 push, pull, branch, and clone from your terminal' }),
          ],
        }),
      ],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Platform Access Control' }),
        el('p', {
          text: 'The deployer is the platform admin. Admins can toggle open repo creation on or off and maintain a list of platform developers. When creation is restricted, only admins and listed developers can create new repos. Everyone else can still browse and read.',
        }),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// For Agents
// ---------------------------------------------------------------------------

/** Render the "For Agents" instruction page with API docs. */
export function renderForAgents(root: HTMLElement): void {
  const codeBlock = (title: string, code: string) =>
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: title }), el('pre', { children: [el('code', { text: code })] })],
    });

  const endpoint = (method: string, path: string, desc: string, auth: string) =>
    el('div', {
      cls: 'how-card fade-in',
      children: [
        el('div', {
          cls: 'how-icon',
          children: [el('span', { cls: 'badge', text: method })],
        }),
        el('h3', { text: path }),
        el('p', { text: desc }),
        el('p', {
          cls: 'modal-hint',
          text: auth,
        }),
      ],
    });

  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'For Agents' }),
        el('p', {
          cls: 'subtitle',
          text: 'Everything an AI agent needs to interact with GitLike programmatically',
        }),
      ],
    }),

    // --- Overview ---
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Overview' }),
        el('p', {
          text: 'GitLike is a decentralized version control system. Repos are IPFS objects pinned via a pluggable storage provider (Pinata or Filebase). Auth is Ethereum wallet signatures (SIWE). The API lives at https://gitlike.dev/api.',
        }),
        el('p', {
          text: 'Base URL: https://gitlike.dev/api  \u2022  All request/response bodies are JSON  \u2022  Auth via Bearer token in Authorization header.',
        }),
      ],
    }),

    // --- Auth Flow ---
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Step 1: Authenticate (SIWE)' }),
        el('p', {
          text: 'GitLike uses Sign-In with Ethereum. You need an Ethereum wallet (private key) to sign messages. Sessions last 24 hours.',
        }),
      ],
    }),
    codeBlock('1a. Get a nonce', 'POST /api/auth/nonce\n\nResponse: { "nonce": "<uuid>" }'),
    codeBlock(
      '1b. Sign a SIWE message and verify',
      'POST /api/auth/verify\nBody: { "message": "<SIWE message>", "signature": "<0x...>" }\n\n' +
        'SIWE message format:\n' +
        '  gitlike.dev wants you to sign in with your Ethereum account:\n' +
        '  0xYourAddress\n\n' +
        '  Sign in to GitLike\n\n' +
        '  URI: https://gitlike.dev\n' +
        '  Version: 1\n' +
        '  Chain ID: 1\n' +
        '  Nonce: <nonce from step 1a>\n' +
        '  Issued At: <ISO timestamp>\n\n' +
        'Response: { "token": "<session-token>", "address": "0x..." }\n\n' +
        'Use the token as: Authorization: Bearer <token>',
    ),

    // --- Core Concepts ---
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Core Concepts' }),
        el('ul', {
          children: [
            el('li', { text: 'Repo = Pinata Group. Identified by a UUID (groupId).' }),
            el('li', {
              text: 'Every file (blob), directory (tree), commit, and manifest is a JSON/binary object pinned to IPFS with a CID.',
            }),
            el('li', {
              text: 'Manifest = repo metadata: name, branches, tags, ACL (owners/developers), visibility.',
            }),
            el('li', {
              text: 'Commits point to a tree CID, parent commit CIDs, author address, timestamp, and message.',
            }),
            el('li', {
              text: 'Trees are arrays of entries: { name, cid, kind: "blob" | "tree", size }.',
            }),
            el('li', {
              text: 'ACL: owners can change settings, developers can commit. Both can read private repos.',
            }),
            el('li', {
              text: 'Encryption: repos can optionally enable client-side AES-256-GCM. Manifest includes encryption config and keyBundle for collaborator key exchange.',
            }),
            el('li', {
              text: 'Delegations let owners grant scoped write access to agent addresses.',
            }),
          ],
        }),
      ],
    }),

    // --- Workflow ---
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Step 2: Typical Workflow' }),
        el('p', {
          text: 'Create repo \u2192 Upload files via presigned URL \u2192 Commit with file CIDs \u2192 Branch / Merge / PR.',
        }),
      ],
    }),

    // --- Endpoint Reference ---
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h2', { text: 'API Reference' })],
    }),

    // Repos
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Repositories' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/repos',
          'List repos. Query: ?limit=20&offset=0. Returns { repos, nextOffset, total }.',
          'Optional auth (shows private repos you own).',
        ),
        endpoint(
          'POST',
          '/api/repos',
          'Create repo. Body: { name, description?, visibility?, license? }. Returns { groupId, manifestCid, commitCid }.',
          'Auth required.',
        ),
        endpoint(
          'GET',
          '/api/repos/:id/manifest',
          'Get repo manifest. Returns { groupId, manifest }.',
          'Optional auth.',
        ),
        endpoint('DELETE', '/api/repos/:id', 'Delete repo. Owner only.', 'Auth required.'),
        endpoint(
          'POST',
          '/api/repos/:id/settings',
          'Update settings. Body: { name?, description?, developers?, protectedBranches?, visibility?, encryption?, keyBundle? }.',
          'Auth required (owner).',
        ),
        endpoint(
          'POST',
          '/api/repos/:id/fork',
          'Fork a repo. Returns { groupId, manifestCid }.',
          'Auth required.',
        ),
      ],
    }),

    // Files
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Files & Commits' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/repos/:id/presign',
          'Get a presigned upload URL (5 min expiry). POST your file as multipart/form-data to the returned URL. Returns { url }.',
          'Auth required.',
        ),
        endpoint(
          'POST',
          '/api/repos/:id/commit',
          'Create a commit. Body: { branch, message, files: [{ path, cid, size, deleted? }], signature? }.',
          'Auth required.',
        ),
        endpoint(
          'GET',
          '/api/repos/:id/commits/:branch',
          'Paginated commit history. Query: ?limit=20&after=<cid>. Returns { commits, nextCursor }.',
          'Optional auth.',
        ),
        endpoint(
          'GET',
          '/api/repos/:id/archive/:branch',
          'Download repo as ZIP file.',
          'Optional auth.',
        ),
      ],
    }),

    // Branches & Tags
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Branches & Tags' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/repos/:id/branch',
          'Create branch. Body: { name, from: "sourceBranch" }.',
          'Auth required.',
        ),
        endpoint('DELETE', '/api/repos/:id/branch/:name', 'Delete a branch.', 'Auth required.'),
        endpoint(
          'POST',
          '/api/repos/:id/merge',
          'Merge branches. Body: { source, target, message?, signature? }.',
          'Auth required.',
        ),
        endpoint(
          'POST',
          '/api/repos/:id/tag/:name',
          'Create tag. Body: { target: "branchName" }.',
          'Auth required.',
        ),
        endpoint('DELETE', '/api/repos/:id/tag/:name', 'Delete a tag.', 'Auth required.'),
      ],
    }),

    // Pull Requests
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Pull Requests' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/repos/:id/pr',
          'Create PR. Body: { title, description?, sourceBranch, targetBranch }.',
          'Auth required.',
        ),
        endpoint(
          'GET',
          '/api/repos/:id/prs',
          'List PRs. Returns { prs: [{ cid, pr }] }.',
          'Optional auth.',
        ),
        endpoint(
          'PATCH',
          '/api/repos/:id/pr/:cid',
          'Update PR status. Body: { status: "open" | "merged" | "closed" }.',
          'Auth required.',
        ),
      ],
    }),

    // Delegations
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Delegations' })],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('p', {
          text: 'Delegations let repo owners grant scoped write access to agent wallets. The server enforces delegation scope on commit, branch, and merge mutations agents can only perform actions allowed by their delegation.',
        }),
      ],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/repos/:id/delegation',
          'Grant agent access. Body: { agent: "0x...", scope: { actions: ["commit","branch","merge"], paths: ["*"] }, expiresInMs?, signature }. The signature is an EIP-712 typed-data signature from the owner.',
          'Auth required (owner).',
        ),
        endpoint(
          'DELETE',
          '/api/repos/:id/delegation/:agent',
          'Revoke agent access. Immediately removes the agent from the ACL.',
          'Auth required (owner).',
        ),
      ],
    }),
    codeBlock(
      'Delegation Scope',
      'scope: {\n' +
        '  actions: ["commit", "branch", "merge"],  // which mutations the agent can perform\n' +
        '  paths: ["*"]                              // glob patterns restricting writable paths\n' +
        '}\n\n' +
        '// Path examples:\n' +
        '// "*"           \u2192 unrestricted (all files)\n' +
        '// "src/**"      \u2192 only files under src/\n' +
        '// "docs/*.md"   \u2192 only markdown files in docs/',
    ),
    codeBlock(
      'EIP-712 Delegation Signature Schema',
      'Domain: { name: "GitLike", version: "1", chainId: 1 }\n\n' +
        'Types: {\n' +
        '  Delegation: [\n' +
        '    { name: "delegator", type: "address" },\n' +
        '    { name: "agent",     type: "address" },\n' +
        '    { name: "repo",      type: "string"  },\n' +
        '    { name: "actions",   type: "string"  },  // comma-joined: "commit,branch,merge"\n' +
        '    { name: "paths",     type: "string"  },  // comma-joined: "*" or "src/**,docs/*"\n' +
        '    { name: "expires",   type: "string"  }   // ISO-8601 timestamp\n' +
        '  ]\n' +
        '}',
    ),

    // Pages
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Pages (Static Hosting)' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/repos/:id/pages',
          'Toggle Pages. Body: { enabled: true/false, slug?: "my-site", branch?: "main" }. Returns { manifestCid, slug }.',
          'Auth required (owner).',
        ),
      ],
    }),
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('p', {
          text:
            'When enabled, the repo is served as a static site at app.gitlike.dev/<slug>. ' +
            'Slug defaults to the repo name. The specified branch (or default branch) is used. ' +
            'Add an index.html at the repo root. Custom 404.html is supported.',
        }),
      ],
    }),

    // Platform
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Platform Settings' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/platform/settings',
          'Get platform settings and caller role. Returns { settings: { openCreation, developers, platformName, platformDescription }, role: "admin" | "developer" | "visitor" }.',
          'Optional auth (role is "visitor" without auth).',
        ),
        endpoint(
          'PUT',
          '/api/platform/settings',
          'Update platform settings. Body: { openCreation?, developers?, platformName?, platformDescription? }.',
          'Auth required (admin only).',
        ),
      ],
    }),

    // Encryption
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Encryption & Public Keys' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/pubkey/:address',
          'Get stored public key for ECDH key exchange. Returns { address, pubkey }.',
          'No auth.',
        ),
        endpoint(
          'PUT',
          '/api/pubkey',
          'Store your wallet public key. Body: { pubkey: "0x..." }. Auto-stored on SIWE verify.',
          'Auth required.',
        ),
      ],
    }),

    // Slugs
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Repo Slugs' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/repos/resolve/:slug',
          'Resolve a human-readable repo slug to its groupId. Returns { groupId }.',
          'No auth.',
        ),
      ],
    }),

    // Identity
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Identity & Profiles' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/alias/:address',
          'Get profile for an address. Returns { alias, pfp, bio }.',
          'No auth.',
        ),
        endpoint(
          'PUT',
          '/api/alias',
          'Set your alias. Body: { alias: "name" }. 1\u201332 chars, letters/digits/hyphens/underscores.',
          'Auth required.',
        ),
        endpoint(
          'PUT',
          '/api/bio',
          'Set your bio. Body: { bio: "text" }. Max 160 characters. Empty string to clear.',
          'Auth required.',
        ),
        endpoint(
          'PUT',
          '/api/pfp',
          'Set profile picture. Body: { url: "https://..." } or { ens: true } or {} to clear.',
          'Auth required.',
        ),
        endpoint(
          'GET',
          '/api/avatar/:address',
          'Proxied profile picture image. Returns image/* or 404.',
          'No auth.',
        ),
        endpoint(
          'GET',
          '/api/user/:address/feed',
          'Atom feed of a creator\u2019s public repos and latest commits.',
          'No auth.',
        ),
        endpoint(
          'GET',
          '/api/user/:address/contributions',
          'Contribution heatmap data (last 365 days). Returns { contributions: { "YYYY-MM-DD": count } }.',
          'No auth.',
        ),
      ],
    }),

    // Social
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Social (Follow & Stars)' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'POST',
          '/api/follow',
          'Follow a user. Body: { address: "0x..." }.',
          'Auth required.',
        ),
        endpoint('DELETE', '/api/follow/:address', 'Unfollow a user.', 'Auth required.'),
        endpoint(
          'GET',
          '/api/followers/:address',
          'List followers. Returns { addresses, count }.',
          'No auth.',
        ),
        endpoint(
          'GET',
          '/api/following/:address',
          'List following. Returns { addresses, count }.',
          'No auth.',
        ),
        endpoint('POST', '/api/repos/:id/star', 'Star a repo.', 'Auth required.'),
        endpoint('DELETE', '/api/repos/:id/star', 'Unstar a repo.', 'Auth required.'),
        endpoint(
          'GET',
          '/api/repos/:id/stars',
          'Get star count and whether caller starred. Returns { count, starred }.',
          'Optional auth.',
        ),
        endpoint(
          'GET',
          '/api/user/:address/starred',
          'List repos starred by a user. Returns { repos: [groupId, ...] }.',
          'No auth.',
        ),
      ],
    }),

    // Projects
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Projects' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/projects',
          'List projects. Query: ?owner=0x... for filtering. Returns { projects }.',
          'Optional auth (shows private projects you own).',
        ),
        endpoint(
          'POST',
          '/api/projects',
          'Create project. Body: { name, description?, repos: [groupId, ...], visibility? }.',
          'Auth required.',
        ),
        endpoint(
          'GET',
          '/api/projects/:id',
          'Get a project. Returns { project }.',
          'Optional auth.',
        ),
        endpoint(
          'PATCH',
          '/api/projects/:id',
          'Update project. Body: { name?, description?, repos?, visibility? }.',
          'Auth required (owner).',
        ),
        endpoint('DELETE', '/api/projects/:id', 'Delete a project.', 'Auth required (owner).'),
        endpoint(
          'GET',
          '/api/projects/resolve/:slug',
          'Resolve a project slug to its ID. Returns { projectId }.',
          'No auth.',
        ),
        endpoint(
          'GET',
          '/api/repos/:id/projects',
          'List projects that contain a repo. Returns { projects }.',
          'No auth.',
        ),
      ],
    }),

    // Federation
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Federation' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/federation/peers',
          'List registered federated peers. Returns { peers }.',
          'No auth.',
        ),
        endpoint(
          'POST',
          '/api/federation/register',
          'Register a federated peer. Body: { domain }.',
          'Auth required (admin).',
        ),
        endpoint(
          'DELETE',
          '/api/federation/peers/:domain',
          'Remove a federated peer.',
          'Auth required (admin).',
        ),
        endpoint(
          'POST',
          '/api/federation/sync',
          'Trigger a sync with all registered peers. Returns { synced }.',
          'Auth required (admin).',
        ),
      ],
    }),

    // Other
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: '\u2501 Other' })],
    }),
    el('div', {
      cls: 'how-grid',
      children: [
        endpoint(
          'GET',
          '/api/repos/licenses',
          'List available license options. Returns { licenses: [{ id, name }] }.',
          'No auth.',
        ),
        endpoint(
          'GET',
          '/api/platform/usage',
          'Storage usage stats. Returns { storageBytes, fileCount }.',
          'Auth required (admin).',
        ),
        endpoint(
          'GET',
          '/api/ipfs/:cid',
          'Proxy fetch an IPFS object by CID (avoids gateway CORS). Returns raw content.',
          'No auth.',
        ),
        endpoint('GET', '/api/health', 'Health check. Returns { ok: true }.', 'No auth.'),
        endpoint(
          'GET',
          '/api/health/deep',
          'Deep health check (KV + storage provider). Returns { ok, checks: { kv, storage } }.',
          'No auth.',
        ),
        endpoint(
          'POST',
          '/api/errors',
          'Client-side error reporting. Body: { error, context?, url?, stack? }. Logged to Worker Logs.',
          'No auth.',
        ),
      ],
    }),

    // --- Example: Full Commit Workflow ---
    codeBlock(
      'Example: Upload a file and commit',
      '// 1. Authenticate (see above)\n\n' +
        '// 2. Create repo\n' +
        'POST /api/repos\n' +
        'Authorization: Bearer <token>\n' +
        'Body: { "name": "my-project", "description": "Built by an agent" }\n' +
        '\u2192 { "groupId": "<uuid>", "manifestCid": "baf..." }\n\n' +
        '// 3. Get presigned upload URL\n' +
        'POST /api/repos/<groupId>/presign\n' +
        'Authorization: Bearer <token>\n' +
        '\u2192 { "url": "https://uploads.pinata.cloud/..." }\n\n' +
        '// 4. Upload file to presigned URL\n' +
        'POST <presigned-url>\n' +
        'Content-Type: multipart/form-data\n' +
        'Body: file=@hello.txt\n' +
        '\u2192 { "data": { "cid": "baf...", "size": 42 } }\n\n' +
        '// 5. Commit the file\n' +
        'POST /api/repos/<groupId>/commit\n' +
        'Authorization: Bearer <token>\n' +
        'Body: {\n' +
        '  "branch": "main",\n' +
        '  "message": "Add hello.txt",\n' +
        '  "files": [{ "path": "hello.txt", "cid": "baf...", "size": 42 }]\n' +
        '}\n' +
        '\u2192 { "commitCid": "baf...", "manifestCid": "baf..." }',
    ),

    // --- Reading data ---
    codeBlock(
      'Reading files (no auth needed for public repos)',
      '// Fetch a tree or blob by CID:\n' +
        'GET /api/ipfs/<cid>\n\n' +
        '// Trees are JSON: { type: "tree", entries: [{ name, cid, kind, size }] }\n' +
        '// Blobs are raw file content\n' +
        '// Commits are JSON: { type: "commit", tree, parents, author, timestamp, message }\n\n' +
        "// To read a repo's files:\n" +
        '// 1. GET /api/repos/<id>/manifest \u2192 manifest.branches["main"] \u2192 commit CID\n' +
        '// 2. GET /api/ipfs/<commitCid> \u2192 commit.tree \u2192 tree CID\n' +
        '// 3. GET /api/ipfs/<treeCid> \u2192 tree.entries\n' +
        '// 4. GET /api/ipfs/<blobCid> \u2192 file content',
    ),

    // --- Example: Agent Delegation Workflow ---
    codeBlock(
      'Example: Agent delegation workflow',
      '// 1. Owner creates a delegation for the agent (via UI or API)\n' +
        'POST /api/repos/<groupId>/delegation\n' +
        'Authorization: Bearer <owner-token>\n' +
        'Body: {\n' +
        '  "agent": "0xAgentAddress",\n' +
        '  "scope": { "actions": ["commit", "branch"], "paths": ["src/**"] },\n' +
        '  "expiresInMs": 86400000,\n' +
        '  "signature": "<EIP-712 signature from owner>"\n' +
        '}\n' +
        '\u2192 { "delegationCid": "baf...", "manifestCid": "baf..." }\n\n' +
        '// 2. Agent authenticates with its own wallet (SIWE)\n' +
        '// (same auth flow as any user)\n\n' +
        '// 3. Agent commits server checks delegation scope automatically\n' +
        'POST /api/repos/<groupId>/commit\n' +
        'Authorization: Bearer <agent-token>\n' +
        'Body: {\n' +
        '  "branch": "main",\n' +
        '  "message": "Update src/index.ts",\n' +
        '  "files": [{ "path": "src/index.ts", "cid": "baf...", "size": 512 }]\n' +
        '}\n' +
        '// \u2713 Allowed: agent has "commit" action and path matches "src/**"\n\n' +
        '// 4. If agent tries to write outside scope:\n' +
        '// files: [{ "path": "README.md", ... }]\n' +
        '// \u2717 403: Not authorized path not covered by delegation',
    ),

    // --- Tips ---
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Tips for Agents' }),
        el('ul', {
          children: [
            el('li', { text: 'All CIDs are content-addressed and immutable. Cache aggressively.' }),
            el('li', {
              text: 'Manifests change on every write. Refetch after mutations. Encrypted repos include encryption and keyBundle fields.',
            }),
            el('li', {
              text: 'Dot-directories (.git/, .vscode/) are automatically filtered. Don\u2019t upload them.',
            }),
            el('li', {
              text: 'Max 200 files per commit. Batch large uploads across multiple commits.',
            }),
            el('li', {
              text: 'Presigned URLs expire in 5 minutes. Get a fresh one per upload batch.',
            }),
            el('li', {
              text: 'Branch names: 1-100 chars, letters/digits/hyphens/slashes/dots/underscores. No ../',
            }),
            el('li', {
              text: 'Rate limiting applies to write endpoints. Space out rapid mutations.',
            }),
            el('li', {
              text: 'To delete a file, include it in the commit files array with deleted: true.',
            }),
            el('li', { text: 'Private repos return 404 for unauthenticated requests.' }),
            el('li', {
              text: 'Delegations let owners grant scoped access to agent wallets without sharing keys.',
            }),
            el('li', {
              text: 'Check GET /api/platform/settings before creating repos \u2014 creation may be restricted to admins and listed developers.',
            }),
          ],
        }),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// Run Your Own — self-hosting & federation
// ---------------------------------------------------------------------------

/** Render the "Run Your Own" self-hosting guide. */
export function renderRunYourOwn(root: HTMLElement): void {
  const section = (icon: string, title: string, body: string) =>
    el('div', {
      cls: 'how-card fade-in',
      children: [
        el('div', { cls: 'how-icon', text: icon }),
        el('h3', { text: title }),
        el('p', { text: body }),
      ],
    });

  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'Run Your Own' }),
        el('p', {
          cls: 'subtitle',
          text: 'Deploy your own GitLike instance and join the decentralized network',
        }),
      ],
    }),

    // Prerequisites
    el('div', {
      cls: 'how-grid',
      children: [
        section(
          '\u2601',
          'Cloudflare Account',
          'Workers (free tier works), KV namespace, and Durable Objects for mutation serialization.',
        ),
        section(
          '\uD83D\uDCCC',
          'Pinata or Filebase Account',
          'IPFS storage provider with a dedicated gateway. Pinata or Filebase \u2014 or both for dual-provider mirroring.',
        ),
        section(
          '\uD83D\uDD11',
          'Ethereum Wallet',
          'The deployer wallet becomes the platform admin. All auth uses Sign-In with Ethereum.',
        ),
        section(
          '\uD83D\uDCE6',
          'Node 20+ & pnpm',
          'Build tooling uses esbuild and TypeScript. pnpm is the package manager.',
        ),
      ],
    }),

    // Quick Start
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Quick Start' }),
        el('pre', {
          children: [
            el('code', {
              text:
                '# Clone the repo\n' +
                'gitlike clone https://github.com/user/gitlike.git\n' +
                'cd gitlike && pnpm install\n\n' +
                '# Create KV namespace\n' +
                'wrangler kv namespace create SESSIONS\n' +
                '# \u2192 Copy the id into wrangler.toml [[kv_namespaces]]\n\n' +
                '# Set secrets (Pinata)\n' +
                'wrangler secret put PINATA_JWT\n' +
                '# Or for Filebase:\n' +
                '# wrangler secret put FILEBASE_TOKEN\n' +
                '# wrangler secret put FILEBASE_KEY\n' +
                '# wrangler secret put FILEBASE_SECRET\n\n' +
                '# Configure wrangler.toml [vars]\n' +
                '#   ALLOWED_ORIGIN = "https://your-domain.com"\n' +
                '#   PLATFORM_ADMIN = "0xYourWalletAddress"\n\n' +
                '# Deploy\n' +
                'pnpm run build && wrangler deploy\n\n' +
                '# Deploy Pages worker (optional)\n' +
                'wrangler deploy -c wrangler-pages.toml',
            }),
          ],
        }),
      ],
    }),

    // Configuration
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Configuration' }),
        el('div', {
          cls: 'how-grid',
          children: [
            section(
              '\uD83D\uDD10',
              'PINATA_JWT (secret)',
              'Your Pinata API key. Set via wrangler secret put \u2014 never committed to code.',
            ),
            section(
              '\uD83C\uDF10',
              'ALLOWED_ORIGIN',
              'Your domain (e.g. https://code.example.com). Used for CORS and SIWE verification.',
            ),
            section(
              '\uD83D\uDC64',
              'PLATFORM_ADMIN',
              'Ethereum address of the platform admin. This wallet gets full control of platform settings.',
            ),
            section(
              '\uD83D\uDDC3',
              'SESSIONS (KV)',
              'Single KV namespace for sessions, manifests, aliases, rate limits, and Pages slugs.',
            ),
            section(
              '\uD83D\uDD12',
              'REPO_LOCK (DO)',
              'Durable Object for serializing repo mutations. Prevents race conditions on concurrent writes.',
            ),
            section(
              '\u2B50',
              'SOCIAL_LOCK (DO)',
              'Durable Object for atomic social operations (stars, follows). Ensures consistent counters.',
            ),
            section(
              '\uD83D\uDCE6',
              'STORAGE_PROVIDER (optional)',
              'Set to "pinata" (default) or "filebase" to choose your storage backend. When both Pinata and Filebase credentials are present, uploads are mirrored to both.',
            ),
            section(
              '\uD83D\uDCC1',
              'Filebase (optional)',
              'FILEBASE_TOKEN, FILEBASE_BUCKET, FILEBASE_KEY, FILEBASE_SECRET, and FILEBASE_GATEWAY. Required only if using Filebase as storage provider.',
            ),
            section(
              '\uD83C\uDF00',
              'FALLBACK_GATEWAYS (optional)',
              'Comma-separated fallback IPFS gateway domains (e.g. dweb.link,w3s.link). Used when the primary gateway is unreachable.',
            ),
          ],
        }),
      ],
    }),

    // Architecture
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Architecture' }),
        el('pre', {
          children: [
            el('code', {
              text:
                'Your Domain\n' +
                '  \u2502  Vanilla TS SPA (static assets)\n' +
                '  \u2502  Wallet auth via SIWE + WalletConnect\n' +
                '  \u25BC\n' +
                'Cloudflare Worker (Hono)\n' +
                '  \u2502  /api/* \u2192 auth, repos, commits, branches, PRs, social\n' +
                '  \u2502  KV \u2192 sessions, manifests, aliases, settings\n' +
                '  \u2502  Durable Objects \u2192 serialized mutations\n' +
                '  \u25BC\n' +
                'Storage Provider (Pinata or Filebase)\n' +
                '  \u2502  Groups \u2022 Presigned uploads \u2022 JSON pinning\n' +
                '  \u2502  Dedicated gateway \u2022 Optional dual-provider mirroring\n' +
                '  \u25BC\n' +
                'IPFS Network\n' +
                '  Content-addressed, decentralized storage\n' +
                '  Same CIDs work from any gateway',
            }),
          ],
        }),
      ],
    }),

    // Federation
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Federation' }),
        el('p', {
          text: 'GitLike instances can join the decentralized network. Since all data lives on IPFS as content-addressed CIDs, repos are portable across instances \u2014 a commit CID is the same regardless of which instance pinned it.',
        }),
        el('div', {
          cls: 'how-grid',
          children: [
            section(
              '\uD83C\uDF10',
              'Auto-Discovery',
              'Every instance exposes /.well-known/gitlike.json with its name, domain, and capabilities. Other instances use this to discover and verify peers.',
            ),
            section(
              '\uD83D\uDD17',
              'Register with the Network',
              'Sign a message with your admin wallet to register your instance on gitlike.dev. Your public repos appear in the global network view.',
            ),
            section(
              '\uD83D\uDCE1',
              'Periodic Sync',
              'The main network periodically polls registered instances for their repo manifests. Federated repos show with a badge indicating the source instance.',
            ),
            section(
              '\uD83D\uDD10',
              'Trust via CIDs',
              'Content integrity is guaranteed by IPFS \u2014 CIDs are self-verifying. No trust layer needed beyond content addressing.',
            ),
          ],
        }),
        el('pre', {
          children: [
            el('code', {
              text:
                '# /.well-known/gitlike.json (served automatically)\n' +
                '{\n' +
                '  "name": "My Instance",\n' +
                '  "domain": "code.example.com",\n' +
                '  "version": "0.1.0",\n' +
                '  "federation": true\n' +
                '}',
            }),
          ],
        }),
      ],
    }),

    // Identity
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Identity is Global' }),
        el('p', {
          text: 'Ethereum wallet addresses work as identity across all instances. A developer who commits on your instance has the same address on gitlike.dev. Display names and avatars are per-instance, but the underlying identity is universal.',
        }),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// CLI Documentation Page
// ---------------------------------------------------------------------------

/** Render the CLI documentation page. */
export function renderCli(root: HTMLElement): void {
  const section = (icon: string, title: string, body: string) =>
    el('div', {
      cls: 'how-card fade-in',
      children: [
        el('div', { cls: 'how-icon', text: icon }),
        el('h3', { text: title }),
        el('p', { text: body }),
      ],
    });

  const codeBlock = (title: string, code: string) =>
    el('div', {
      cls: 'how-section fade-in',
      children: [el('h3', { text: title }), el('pre', { children: [el('code', { text: code })] })],
    });

  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'GitLike CLI' }),
        el('p', {
          cls: 'subtitle',
          text: 'Manage repos from your terminal \u2014 push, pull, branch, and more',
        }),
      ],
    }),

    // Overview cards
    el('div', {
      cls: 'how-grid',
      children: [
        section(
          '\uD83D\uDCE6',
          'Install',
          'Install globally with npm or pnpm. Requires Node.js 18+.',
        ),
        section(
          '\uD83D\uDD11',
          'Wallet Auth',
          'Sign in with your Ethereum wallet via browser-based SIWE, or supply a token directly.',
        ),
        section(
          '\uD83D\uDCC1',
          'Local Repos',
          'Init new repos or clone existing ones. State is tracked in a .gitlike/ directory.',
        ),
        section(
          '\uD83D\uDD00',
          'Branches',
          'List, create, and switch branches. Switching downloads the full tree from IPFS.',
        ),
      ],
    }),

    // Installation
    codeBlock('Installation', 'npm install -g gitlike\n# or\npnpm add -g gitlike'),

    // Authentication
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Authentication' }),
        el('p', {
          text: 'The CLI authenticates via Sign-In with Ethereum (SIWE). Running "gitlike auth login" opens your browser to sign a message with your wallet. The session token is saved to ~/.gitlike/config.json.',
        }),
      ],
    }),
    codeBlock('Browser login (recommended)', 'gitlike auth login'),
    codeBlock(
      'Token login (CI / scripts)',
      'gitlike auth login --token <token> --address <address>',
    ),
    codeBlock('Check status / logout', 'gitlike auth status\ngitlike auth logout'),

    // Creating & cloning
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Creating & Cloning Repos' }),
        el('p', {
          text: 'Use "init" to create a new repo in the current directory, or "clone" to download an existing one by its group ID.',
        }),
      ],
    }),
    codeBlock(
      'Create a new repo',
      'gitlike init my-project\ngitlike init my-project -d "Description" --private --license MIT',
    ),
    codeBlock(
      'Clone an existing repo',
      'gitlike clone <groupId>\ngitlike clone <groupId> my-folder',
    ),

    // Day-to-day workflow
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Day-to-Day Workflow' }),
        el('p', {
          text: 'Push uploads changed files to IPFS and creates a new commit. Pull downloads the latest remote commit to your working directory.',
        }),
      ],
    }),
    codeBlock(
      'Push changes',
      'gitlike push -m "feat: add login page"\ngitlike push -m "fix: typo" --files src/app.ts README.md',
    ),
    codeBlock('Pull latest', 'gitlike pull'),

    // Inspection
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Inspection' }),
        el('p', {
          text: 'Check repo state, view commit history, and see which files have changed since your last push or pull.',
        }),
      ],
    }),
    codeBlock(
      'Status, log, and diff',
      'gitlike status        # repo info + sync state\ngitlike log           # commit history (default: 20)\ngitlike log -n 5      # last 5 commits\ngitlike diff          # added / modified / deleted files',
    ),

    // Branching
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Branching' }),
        el('p', {
          text: 'Branches are managed on the remote manifest. Creating a branch forks from the current branch; switching downloads the target tree.',
        }),
      ],
    }),
    codeBlock(
      'Branch commands',
      'gitlike branch list         # list remote branches\ngitlike branch create dev    # create "dev" from current branch\ngitlike switch dev            # switch to "dev" and pull files',
    ),

    // Config files
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Configuration' }),
        el('p', {
          text: 'The CLI stores two config files. Global auth lives in your home directory; per-repo state lives alongside your code.',
        }),
      ],
    }),
    codeBlock(
      '~/.gitlike/config.json (global)',
      '{\n  "apiUrl": "https://gitlike.dev",\n  "token": "<session-token>",\n  "address": "0x..."\n}',
    ),
    codeBlock(
      '.gitlike/repo.json (per repo)',
      '{\n  "groupId": "<pinata-group-id>",\n  "name": "my-project",\n  "branch": "main",\n  "head": "<commit-cid>"\n}',
    ),

    // Command reference
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'Command Reference' }),
        el('pre', {
          children: [
            el('code', {
              text:
                'gitlike auth login              Sign in via browser (SIWE)\n' +
                'gitlike auth login --token T    Direct token login\n' +
                'gitlike auth logout             Clear stored credentials\n' +
                'gitlike auth status             Show auth info\n' +
                '\n' +
                'gitlike init <name>             Create a new repo\n' +
                'gitlike clone <groupId> [dir]   Clone a repo\n' +
                '\n' +
                'gitlike push -m <msg>           Push changes\n' +
                'gitlike pull                    Pull latest\n' +
                '\n' +
                'gitlike status                  Repo info\n' +
                'gitlike log [-n count]          Commit history\n' +
                'gitlike diff                    Changed files\n' +
                '\n' +
                'gitlike branch list             List branches\n' +
                'gitlike branch create <name>    New branch\n' +
                'gitlike switch <branch>         Switch branch',
            }),
          ],
        }),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

/** Render the About page. */
export function renderAbout(root: HTMLElement): void {
  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'About GitLike' }),
        el('p', {
          cls: 'subtitle',
          text: 'Why it exists and where it\u2019s going',
        }),
      ],
    }),

    // Story
    el('div', {
      cls: 'about-story fade-in',
      children: [
        el('p', {
          text: 'I built GitLike because code hosting shouldn\u2019t depend on a single company. Every year a platform changes its pricing, restricts features, or disappears and developers scramble to migrate. Your source code deserves better.',
        }),
        el('p', {
          text: 'GitLike stores everything on IPFS as content-addressed objects. Commits, trees, and blobs live on a decentralized network. Authentication uses your Ethereum wallet via SIWE, so there are no passwords to leak.',
        }),
        el('p', {
          text: 'The goal is simple: a Git-like workflow where you actually own your data. Fork it, self-host it, federate it under your domain. Your code, your keys.',
        }),
      ],
    }),

    // How to use
    el('div', {
      cls: 'how-section fade-in',
      children: [
        el('h2', { text: 'How It\u2019s Meant to Be Used' }),
        el('div', {
          cls: 'how-grid',
          children: [
            aboutCard(
              '\uD83D\uDE80',
              'For Solo Developers',
              'Create a repo, push your code, and know it\u2019s pinned on IPFS. Your CIDs are yours forever.',
            ),
            aboutCard(
              '\uD83D\uDC65',
              'For Teams',
              'Add developers via wallet addresses. Use branch protection, pull requests, and agent delegations to collaborate with clear ownership.',
            ),
            aboutCard(
              '\uD83E\uDD16',
              'For AI Agents',
              'Delegate scoped write access to AI agents with EIP-191 signatures. Agents can commit, branch, and merge within the boundaries you set.',
            ),
            aboutCard(
              '\uD83C\uDFE0',
              'For Self-Hosters',
              'Deploy your own instance on Cloudflare Workers. Join the federation to make your repos discoverable across the network.',
            ),
          ],
        }),
      ],
    }),

    // Connect
    el('div', {
      cls: 'about-connect fade-in',
      children: [
        el('h2', { text: 'Connect' }),
        el('p', {
          cls: 'about-connect-text',
          text: 'Follow along, share feedback, or just say hi.',
        }),
        el('div', {
          cls: 'about-social',
          children: [
            socialLink(
              '(Twitter)',
              'https://x.com/LordOfThePies4',
              'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
            ),
            socialLink(
              'Farcaster',
              'https://farcaster.xyz/bane84',
              'M5.868 3h12.264v18H16.2v-7.412c0-.588-.01-1.2-.02-1.836-.052-1.596-.436-2.808-1.464-3.636-.984-.792-2.1-.9-3.168-.624-.768.204-1.392.636-1.86 1.224-.516.648-.78 1.488-.804 2.4v9.884H6.96v-7.452c0-.852-.012-1.308-.036-1.788-.084-1.644-.456-2.868-1.5-3.696-.996-.792-2.124-.888-3.192-.612-.768.204-1.404.636-1.872 1.224-.516.648-.78 1.488-.804 2.4V21H0V3z',
            ),
            socialLink(
              'YouTube',
              'https://youtube.com/@interlooper',
              'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
            ),
          ],
        }),
      ],
    }),

    // Open source note
    el('div', {
      cls: 'about-oss fade-in',
      children: [
        el('p', {
          text: 'GitLike is open-source. The entire codebase is available on GitLike itself. Eat your own dog food.',
        }),
      ],
    }),
  );
}

/** Card for about page sections. */
function aboutCard(icon: string, title: string, body: string): HTMLElement {
  return el('div', {
    cls: 'how-card fade-in',
    children: [
      el('div', { cls: 'how-icon', text: icon }),
      el('h3', { text: title }),
      el('p', { text: body }),
    ],
  });
}

/** Social link with SVG icon. */
function socialLink(label: string, href: string, svgPath: string): HTMLElement {
  return el('a', {
    cls: 'about-social-link',
    attrs: { href, target: '_blank', rel: 'noopener' },
    children: [
      (() => {
        const wrap = el('span', { cls: 'about-social-icon' });
        wrap.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="${svgPath}"/></svg>`;
        return wrap;
      })(),
      el('span', { text: label }),
    ],
  });
}

// ---------------------------------------------------------------------------
// CLI Auth browser-based auth callback for the CLI
// ---------------------------------------------------------------------------

/** Render the CLI auth page (SIWE â†’ POST token to localhost callback). */
export async function renderCliAuth(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');

  const status = el('p', { cls: 'subtitle', text: 'Preparing authentication...' });

  render(
    root,
    el('header', {
      cls: 'site-header',
      children: [
        el('h1', { cls: 'hero-title', text: 'CLI Authentication' }),
        el('p', {
          cls: 'subtitle',
          text: 'Sign in with your wallet to authenticate the GitLike CLI.',
        }),
      ],
    }),
    el('div', { cls: 'how-section', children: [status] }),
  );

  if (!port) {
    status.textContent = 'Missing port parameter. Please run "gitlike auth login" from the CLI.';
    return;
  }

  try {
    // Step 1: connect wallet
    status.textContent = 'Connecting wallet...';
    let addr = connectedAddress();
    if (!addr) addr = await connect();

    // Step 2: SIWE sign-in
    status.textContent = 'Please sign the message in your wallet...';
    const token = await authenticateWithSiwe();

    // Step 3: POST token to CLI localhost callback
    status.textContent = 'Sending credentials to CLI...';
    const loopback = [127, 0, 0, 1].join('.');
    const callbackUrl = `http://${loopback}:${port}/callback`;
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, address: addr }),
    });

    if (!res.ok) throw new Error(`CLI callback failed: ${res.status}`);

    status.textContent =
      '\u2713 Authenticated! You can close this tab and return to your terminal.';
    status.style.color = 'var(--color-green, #22c55e)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status.textContent = `Authentication failed: ${msg}`;
    status.style.color = 'var(--color-red, #ef4444)';
  }
}
