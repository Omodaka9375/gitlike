# Backup & Disaster Recovery

GitLike stores all data on IPFS via Pinata, with session/manifest pointers in Cloudflare KV. This document describes the backup strategy and recovery procedures.

## Data Architecture

| Layer | Storage | What it holds |
|-------|---------|---------------|
| IPFS (Pinata) | Content-addressed blobs | Trees, commits, manifests, files, PRs |
| Cloudflare KV | Key-value pairs | Session tokens, manifest CID pointers, rate-limit counters |
| Cloudflare DO | Durable Objects (SQLite) | RepoLock serialization state (ephemeral) |

## IPFS / Pinata

All repository content is pinned to Pinata's IPFS infrastructure. Because IPFS data is content-addressed, any CID can be verified independently.

### Redundancy options

1. **Pinata Dedicated Gateway** — already configured; provides fast reads and caching.
2. **Secondary pin service** — pin the same CIDs to a second provider (e.g. web3.storage, Filebase, or a self-hosted IPFS node) for geographic redundancy.
3. **Local backup** — use the Pinata API to export all CIDs for a given repo group and re-pin them to local storage.

### Exporting repo data

```bash
# List all files in a repo group
curl -H "Authorization: Bearer $PINATA_JWT" \
  "https://api.pinata.cloud/v3/files/public?group=$GROUP_ID"

# Download a specific CID
curl "https://$GATEWAY/ipfs/$CID" -o backup.json
```

The `/api/repos/:id/archive/:branch` endpoint also produces a ZIP of any branch for quick offline backups.

## Cloudflare KV

KV stores ephemeral data (sessions, rate limits) and one critical piece: `manifest:<groupId>` → latest manifest CID.

### Recovery

If KV data is lost:
1. Sessions expire naturally — users simply re-authenticate.
2. Manifest pointers can be rebuilt by scanning Pinata for the latest `manifest.json` in each repo group:
   ```bash
   curl -H "Authorization: Bearer $PINATA_JWT" \
     "https://api.pinata.cloud/v3/files/public?group=$GROUP_ID&keyvalues[type]=manifest"
   ```
3. The most recent manifest CID from the listing should be written back to KV.

## Durable Objects

RepoLock DOs are ephemeral write serializers. They hold no permanent state — if they're lost, the next write request simply creates a new instance.

## Monitoring

- **`GET /api/health`** — lightweight liveness check.
- **`GET /api/health/deep`** — verifies both KV and Pinata gateway connectivity. Returns `503` if either is down.

## Disaster Recovery Checklist

1. Verify Pinata account status and pin count.
2. Confirm KV namespace exists and contains manifest pointers (`wrangler kv key list --namespace-id=...`).
3. Hit `/api/health/deep` to confirm end-to-end connectivity.
4. If manifest pointers are missing, rebuild from Pinata listing (see above).
5. Redeploy worker if needed: `pnpm run deploy`.
