// ---------------------------------------------------------------------------
// GitLike — Worker Environment Bindings
// ---------------------------------------------------------------------------

/** Cloudflare Worker environment bindings. */
export type Env = {
  /** KV namespace for all application data (sessions, manifests, aliases, pages slugs, rate limits). */
  SESSIONS: KVNamespace;
  /** Durable Object namespace for repo mutation serialization. */
  REPO_LOCK: DurableObjectNamespace;
  /** Durable Object namespace for atomic social mutations (follow/star). */
  SOCIAL_LOCK: DurableObjectNamespace;
  /** Static assets binding for SPA fallback. */
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  /** Pinata API JWT (secret). */
  PINATA_JWT: string;
  /** Pinata dedicated gateway domain. */
  PINATA_GATEWAY: string;
  /** Allowed origin for SIWE verification (e.g. "https://gitlike.example.com"). */
  ALLOWED_ORIGIN: string;
  /** Wallet address of the platform admin (deployer). */
  PLATFORM_ADMIN: string;
  /** Storage provider: 'pinata' (default) or 'filebase'. */
  STORAGE_PROVIDER?: string;
  /** Optional: Filebase IPFS RPC API token. */
  FILEBASE_TOKEN?: string;
  /** Optional: Filebase bucket name. */
  FILEBASE_BUCKET?: string;
  /** Optional: Filebase S3 access key ID (for presigned URLs). */
  FILEBASE_KEY?: string;
  /** Optional: Filebase S3 secret access key (for presigned URLs). */
  FILEBASE_SECRET?: string;
  /** Optional: Filebase dedicated gateway URL (e.g. https://mygateway.myfilebase.com). */
  FILEBASE_GATEWAY?: string;
  /** Optional: comma-separated fallback IPFS gateways (e.g. dweb.link,w3s.link). */
  FALLBACK_GATEWAYS?: string;
};
