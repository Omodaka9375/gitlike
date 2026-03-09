# KV Key Prefixes

GitLike uses a single Cloudflare KV namespace (`SESSIONS`) for all application data. Keys are organized by prefix to avoid collisions.

## Prefix Reference

### `session:<token>` → Ethereum address
- **Purpose:** Active SIWE session
- **TTL:** 24 hours
- **Writer:** Main worker (`POST /api/auth/verify`)
- **Readers:** Main worker (auth middleware)

### `nonce:<uuid>` → `"1"`
- **Purpose:** Single-use SIWE nonce
- **TTL:** 5 minutes
- **Writer:** Main worker (`POST /api/auth/nonce`)
- **Readers:** Main worker (`POST /api/auth/verify`, then deleted)

### `rate:<address>:<minute>` → count string
- **Purpose:** Per-address write rate limiting
- **TTL:** 2 minutes
- **Writer:** Main worker (rate limit middleware)
- **Readers:** Main worker (rate limit middleware)
- **Note:** Non-atomic get→put; acceptable at current traffic levels

### `manifest:<groupId>` → IPFS CID
- **Purpose:** Latest manifest CID pointer for a repo
- **TTL:** Permanent (no expiry)
- **Writer:** Main worker (any mutation that updates the manifest)
- **Readers:** Main worker, Pages worker

### `alias:<address>` → display name string
- **Purpose:** Human-readable alias for a wallet address
- **TTL:** Permanent
- **Writer:** Main worker (`PUT /api/alias`)
- **Readers:** Main worker (`GET /api/alias/:address`, feeds)

### `pfp:<address>` → URL string
- **Purpose:** Profile picture URL for a wallet address
- **TTL:** Permanent
- **Writer:** Main worker (`PUT /api/pfp`)
- **Readers:** Main worker (`GET /api/alias/:address`, `GET /api/avatar/:address`)

### `pages:<slug>` → Pinata group ID
- **Purpose:** Maps a Pages slug to its repo
- **TTL:** Permanent
- **Writer:** Main worker (`POST /api/repos/:id/pages`)
- **Readers:** Pages worker (slug resolution)

### `backup:manifests:<YYYY-MM-DD>` → JSON object
- **Purpose:** Daily snapshot of all manifest CID pointers
- **TTL:** 30 days
- **Writer:** Main worker (scheduled handler, 03:00 UTC daily)
- **Readers:** Manual recovery only

### `platform:settings` → JSON object
- **Purpose:** Platform-wide access control (open creation toggle, writers list, instance name)
- **TTL:** Permanent
- **Writer:** Main worker (`PUT /api/platform/settings`, admin only)
- **Readers:** Main worker (`GET /api/platform/settings`, `POST /api/repos` creation gate)
- **Shape:** `{ openCreation: boolean, writers: string[], platformName: string, platformDescription: string }`

### `following:<address>` → JSON array of addresses
- **Purpose:** List of addresses this user follows
- **TTL:** Permanent
- **Writer:** Main worker (`POST /api/follow`, `DELETE /api/follow/:address`)
- **Readers:** Main worker (`GET /api/following/:address`)

### `followers:<address>` → JSON array of addresses
- **Purpose:** List of addresses that follow this user (denormalized for fast reads)
- **TTL:** Permanent
- **Writer:** Main worker (`POST /api/follow`, `DELETE /api/follow/:address`) — dual-write with `following:`
- **Readers:** Main worker (`GET /api/followers/:address`)
- **Note:** Non-atomic get→put; acceptable at current traffic levels

### `activity:<address>:<year>` → JSON object
- **Purpose:** Per-user daily contribution counts for the contribution graph
- **TTL:** Permanent
- **Writer:** Main worker (RepoLock DO — after commit and merge mutations)
- **Readers:** Main worker (`GET /api/user/:address/contributions`)
- **Shape:** `Record<string, number>` mapping `YYYY-MM-DD` → commit count
- **Note:** Non-atomic across repos (acceptable — worst case off by 1)

### `health:ping` → `"ok"`
- **Purpose:** KV connectivity check
- **TTL:** 1 minute
- **Writer:** Main worker (`GET /api/health/deep`)
- **Readers:** Main worker (`GET /api/health/deep`)

## Cross-Worker Access

Both the **main worker** and the **Pages worker** share the same KV namespace. The Pages worker only reads `pages:` and `manifest:` prefixes.
