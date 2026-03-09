// ---------------------------------------------------------------------------
// GitLike — Configuration
// All tunables live here so they're easy to find and change.
// ---------------------------------------------------------------------------

/** Maximum commits to fetch when walking history. */
export const MAX_LOG_DEPTH = 50;

/** Ethereum chain ID for signing (mainnet = 1, sepolia = 11155111). */
export const CHAIN_ID = 1;

/** WalletConnect Cloud project ID. Get one at https://cloud.walletconnect.com */
export const WALLETCONNECT_PROJECT_ID = '4c1f2acba811e2b1aade272bcf58eaae';

/** Build a full gateway URL for a given CID and optional path. */
export function gatewayUrl(cid: string, path = ''): string {
  // Proxy through our worker to avoid 403s from restricted Pinata gateways
  const base = `/api/ipfs/${cid}`;
  return path ? `${base}/${path}` : base;
}
