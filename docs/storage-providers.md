# Storage Providers

GitLike stores all repository data (trees, commits, manifests, blobs) on IPFS. The storage layer is provider-agnostic — you can use **Pinata** or **Filebase** as your IPFS backend, or run both simultaneously for redundancy.

## Architecture

```
Consumer code (operations, mutations, index)
        │
        ▼
    ipfs.ts          ← provider-agnostic domain logic
        │               (gateway fallback, KV signatures,
        │                manifest helpers, commit walking)
        ▼
    storage.ts       ← StorageProvider interface + factory
        │
   ┌────┴────┐
   ▼         ▼
Pinata    Filebase    ← concrete implementations
```

**Key files:**

- `worker/storage.ts` — `StorageProvider` type, `createStorage()` factory, `MirroredProvider`
- `worker/storage-pinata.ts` — Pinata implementation (wraps PinataSDK)
- `worker/storage-filebase.ts` — Filebase implementation (IPFS RPC API + S3)
- `worker/ipfs.ts` — Provider-agnostic layer: uploads, gateway reads with fallback, KV-based signatures, manifest helpers, commit history, pruning

## Provider Comparison

### Pinata (default)

- Uses the official PinataSDK (`pinata` npm package)
- Repos are mapped to Pinata "groups" — `createRepo()` creates a real group
- `deleteRepo()` deletes the group on Pinata
- Presigned URLs use Pinata's native signed URL API
- Usage stats from `GET /data/userPinnedDataTotal` (v1 API), with v3 file list fallback
- Gateway: `https://<PINATA_GATEWAY>/ipfs/<cid>`

### Filebase

- Uses Filebase's IPFS RPC API (`https://api.filebase.io/v0`) for uploads and pins
- Repos are UUID-based (Filebase has no group concept) — `createRepo()` returns a random UUID
- `deleteRepo()` is a no-op (KV handles tracking)
- Presigned URLs use AWS4-HMAC-SHA256 signed S3 PutObject URLs (`s3.filebase.com`)
- Usage stats from `GET /api/v0/pin/ls?type=recursive`
- Gateway: `https://ipfs.filebase.io/ipfs/<cid>` (or custom `FILEBASE_GATEWAY`)

## Configuration

### Environment Variables

Set via `wrangler secret put` (secrets) or `[vars]` in `wrangler.toml` (non-sensitive):

#### Core

| Variable | Required | Description |
|---|---|---|
| `STORAGE_PROVIDER` | No | `'pinata'` (default) or `'filebase'` |
| `FALLBACK_GATEWAYS` | No | Comma-separated IPFS gateway domains for read fallback (e.g. `dweb.link,w3s.link`) |

#### Pinata

| Variable | Required | Description |
|---|---|---|
| `PINATA_JWT` | Yes (if Pinata) | Pinata API JWT — set as a secret |
| `PINATA_GATEWAY` | Yes (if Pinata) | Dedicated gateway domain (e.g. `mygw.mypinata.cloud`) |

#### Filebase

| Variable | Required | Description |
|---|---|---|
| `FILEBASE_TOKEN` | Yes (if Filebase) | IPFS RPC API bearer token — set as a secret |
| `FILEBASE_BUCKET` | Yes (if Filebase) | S3 bucket name |
| `FILEBASE_KEY` | For presigned URLs | S3 access key ID — set as a secret |
| `FILEBASE_SECRET` | For presigned URLs | S3 secret access key — set as a secret |
| `FILEBASE_GATEWAY` | No | Custom gateway URL (default: `https://ipfs.filebase.io`) |

### Example: Pinata Only (default)

```toml
[vars]
ALLOWED_ORIGIN = "https://gitlike.dev"
PLATFORM_ADMIN = "0xYourAddress"
PINATA_GATEWAY = "mygw.mypinata.cloud"
```

```sh
wrangler secret put PINATA_JWT
```

### Example: Filebase Only

```toml
[vars]
ALLOWED_ORIGIN = "https://gitlike.dev"
PLATFORM_ADMIN = "0xYourAddress"
STORAGE_PROVIDER = "filebase"
FILEBASE_BUCKET = "my-gitlike-bucket"
FILEBASE_GATEWAY = "https://mygw.myfilebase.com"
```

```sh
wrangler secret put FILEBASE_TOKEN
wrangler secret put FILEBASE_KEY
wrangler secret put FILEBASE_SECRET
```

### Example: Pinata Primary + Filebase Mirror

Leave `STORAGE_PROVIDER` unset (or `pinata`) and add Filebase credentials. The factory auto-detects both and enables mirroring:

```toml
[vars]
ALLOWED_ORIGIN = "https://gitlike.dev"
PLATFORM_ADMIN = "0xYourAddress"
PINATA_GATEWAY = "mygw.mypinata.cloud"
FILEBASE_BUCKET = "my-gitlike-bucket"
```

```sh
wrangler secret put PINATA_JWT
wrangler secret put FILEBASE_TOKEN
```

## Mirrored Provider

When Pinata is the primary and both `FILEBASE_TOKEN` and `FILEBASE_BUCKET` are present, `createStorage()` returns a `MirroredProvider` (reported name: `pinata+filebase`).

**Behavior:**

- `uploadJSON` / `uploadBlob` — writes to Pinata first, then fire-and-forgets the same upload to Filebase
- `unpin` — unpins on Pinata, then fire-and-forgets unpin on Filebase
- `createRepo` / `deleteRepo` / `presignUpload` / `gatewayUrl` / `healthCheck` / `getUsage` — delegates to primary (Pinata) only

Mirror failures are silently caught and never block the primary write path.

## Gateway Fallback

All IPFS reads (`fetchJSON`, `fetchRaw` in `ipfs.ts`) try multiple gateways in order:

1. **Primary provider gateway** — based on the active `StorageProvider`
2. **Cross-provider gateway** — if using Filebase, tries Pinata gateway as fallback (and vice versa), when the other gateway is configured
3. **Additional fallback gateways** — from `FALLBACK_GATEWAYS` env var

Auth headers (Pinata JWT bearer token) are automatically attached when the URL matches the Pinata gateway domain.

## StorageProvider Interface

All providers implement this interface (defined in `worker/storage.ts`):

```ts
type StorageProvider = {
  readonly name: string;
  createRepo(name: string): Promise<string>;
  deleteRepo(repoId: string): Promise<void>;
  uploadJSON(data: unknown, repo: string, meta?: Record<string, string>): Promise<UploadResult>;
  uploadBlob(file: File, repo: string, name?: string): Promise<UploadResult>;
  unpin(cid: string): Promise<void>;
  presignUpload(repo: string, expires?: number): Promise<string>;
  gatewayUrl(cid: string, path?: string): string;
  healthCheck(): Promise<boolean>;
  getUsage(): Promise<StorageUsage>;
};
```

## Switching Providers

Since all data lives on IPFS (content-addressed by CID) and manifest pointers are in KV, switching providers is seamless:

1. Set the new provider's env vars
2. Change `STORAGE_PROVIDER` if switching primary
3. Deploy

Existing CIDs remain accessible via gateway fallback. New uploads go to the new provider. No data migration needed — IPFS CIDs are provider-independent.

## Health Check

`GET /api/health/deep` reports storage provider health:

```json
{
  "ok": true,
  "checks": {
    "kv": true,
    "storage": true
  }
}
```

The `storage` check calls `provider.healthCheck()`, which pings the provider's gateway (Pinata) or RPC version endpoint (Filebase).

## Admin Panel

The Platform Settings modal (admin only) shows:

- **Storage Usage** — bytes and file count from `provider.getUsage()`
- **Storage Provider** — reachability status from the deep health check
