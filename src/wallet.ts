// ---------------------------------------------------------------------------
// GitLike — Wallet Connection
// Uses viem with injected browser wallets (MetaMask, Rainbow, etc.).
// ---------------------------------------------------------------------------

import { createWalletClient, custom, type WalletClient, type Transport, type Chain } from 'viem';
import { mainnet } from 'viem/chains';
import type { Address } from './types.js';
import { CHAIN_ID, WALLETCONNECT_PROJECT_ID } from './config.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Active chain derived from CHAIN_ID config. Defaults to mainnet. */
const activeChain: Chain = CHAIN_ID === 1 ? mainnet : { ...mainnet, id: CHAIN_ID };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _walletClient: WalletClient | null = null;
let _connectedAddress: Address | null = null;
let _listeners: Array<(addr: Address | null) => void> = [];

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** Check if an injected provider (e.g. MetaMask) is available. */
export function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

/** Connect to the injected wallet. Returns the connected address. */
export async function connect(): Promise<Address> {
  if (!hasInjectedProvider()) {
    throw new Error('No wallet detected. Install MetaMask or another browser wallet.');
  }

  // Clear logout flag on explicit connect
  localStorage.removeItem(LOGOUT_KEY);

  const transport: Transport = custom(window.ethereum!);

  _walletClient = createWalletClient({
    chain: activeChain,
    transport,
  });

  const [address] = await _walletClient.requestAddresses();
  _connectedAddress = address as Address;
  _notify();
  return _connectedAddress;
}

/**
 * Silently restore a previous session if the wallet is already authorized.
 * Uses eth_accounts (no popup) instead of eth_requestAccounts.
 */
export async function reconnect(): Promise<Address | null> {
  if (!hasInjectedProvider()) return null;
  // Skip if user explicitly logged out
  if (localStorage.getItem(LOGOUT_KEY)) return null;
  try {
    const accounts = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[];
    if (!accounts || accounts.length === 0) return null;

    const transport: Transport = custom(window.ethereum!);
    _walletClient = createWalletClient({ chain: activeChain, transport });
    _connectedAddress = accounts[0] as Address;
    _notify();
    return _connectedAddress;
  } catch {
    return null;
  }
}

/** LocalStorage key to remember explicit logout across refreshes. */
const LOGOUT_KEY = 'gitlike_logged_out';

/** Disconnect (clear local state and server session). */
export async function disconnect(): Promise<void> {
  const { logout } = await import('./api.js');
  await logout();
  if (_wcProvider) {
    try {
      await _wcProvider.disconnect();
    } catch {
      /* best-effort */
    }
    _wcProvider = null;
  }
  _walletClient = null;
  _connectedAddress = null;
  localStorage.setItem(LOGOUT_KEY, '1');
  _notify();
}

/** Get the currently connected address, or null. */
export function connectedAddress(): Address | null {
  return _connectedAddress;
}

/** Get the wallet client. Throws if not connected. */
export function walletClient(): WalletClient {
  if (!_walletClient) throw new Error('Wallet not connected.');
  return _walletClient;
}

// ---------------------------------------------------------------------------
// WalletConnect
// ---------------------------------------------------------------------------

/** Cached WC provider for disconnect cleanup. */
let _wcProvider: { disconnect: () => Promise<void> } | null = null;

/** Connect via WalletConnect (mobile wallets, QR code). */
export async function connectWalletConnect(): Promise<Address> {
  // Clear logout flag on explicit connect
  localStorage.removeItem(LOGOUT_KEY);

  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [activeChain.id],
    showQrModal: true,
  });

  await provider.enable();
  _wcProvider = provider;

  const transport: Transport = custom(provider);
  _walletClient = createWalletClient({ chain: activeChain, transport });

  const accounts = provider.accounts;
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from WalletConnect.');
  }
  _connectedAddress = accounts[0] as Address;
  _notify();
  return _connectedAddress;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Subscribe to connection state changes. Returns unsubscribe fn. */
export function onAccountChange(fn: (addr: Address | null) => void): () => void {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

function _notify(): void {
  for (const fn of _listeners) fn(_connectedAddress);
}

// ---------------------------------------------------------------------------
// Provider event listeners — detect wallet lock / account switch
// ---------------------------------------------------------------------------

let _providerListenersAttached = false;

/** Attach listeners to the injected provider for account/chain changes. */
export function attachProviderListeners(): void {
  if (_providerListenersAttached || !hasInjectedProvider()) return;
  _providerListenersAttached = true;

  const provider = window.ethereum!;

  provider.on?.('accountsChanged', (accounts: string[]) => {
    if (!accounts || accounts.length === 0) {
      // Wallet locked or disconnected — clear session
      _walletClient = null;
      _connectedAddress = null;
      import('./api.js').then(({ clearSessionToken }) => clearSessionToken());
      _notify();
      // Re-render the current view
      window.dispatchEvent(new CustomEvent('wallet-changed'));
    } else if (accounts[0].toLowerCase() !== _connectedAddress?.toLowerCase()) {
      // Account switched — clear stale session, update address
      _connectedAddress = accounts[0] as Address;
      import('./api.js').then(({ clearSessionToken }) => clearSessionToken());
      _notify();
      window.dispatchEvent(new CustomEvent('wallet-changed'));
    }
  });

  provider.on?.('disconnect', () => {
    _walletClient = null;
    _connectedAddress = null;
    import('./api.js').then(({ clearSessionToken }) => clearSessionToken());
    _notify();
    window.dispatchEvent(new CustomEvent('wallet-changed'));
  });
}

// ---------------------------------------------------------------------------
// SIWE Authentication
// ---------------------------------------------------------------------------

/** Perform SIWE sign-in after wallet connection. */
export async function authenticateWithSiwe(): Promise<string> {
  const address = connectedAddress();
  if (!address || !_walletClient) throw new Error('Wallet not connected.');

  const { fetchNonce, verifySignature } = await import('./api.js');

  // 1. Get nonce from server
  const nonce = await fetchNonce();

  // 2. Build SIWE message
  const domain = window.location.host;
  const origin = window.location.origin;
  const issuedAt = new Date().toISOString();
  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to GitLike',
    '',
    `URI: ${origin}`,
    'Version: 1',
    `Chain ID: ${activeChain.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  // 3. Sign with wallet
  const signature = await _walletClient.signMessage({
    account: address,
    message,
  });

  // 4. Verify on server, get session token
  const result = await verifySignature(message, signature);
  return result.token;
}
