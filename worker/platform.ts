// ---------------------------------------------------------------------------
// GitLike — Platform-Level Access Control
// Admin/Writer/Visitor roles and repo creation gating.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** KV key for platform settings. */
const PLATFORM_SETTINGS_KEY = 'platform:settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Platform-wide settings stored in KV. */
export type PlatformSettings = {
  /** Allow any authenticated user to create repos. */
  openCreation: boolean;
  /** Wallet addresses allowed to create repos when openCreation is false. */
  writers: string[];
  /** Optional instance name. */
  platformName: string;
  /** Optional instance description. */
  platformDescription: string;
  /** Max commits per branch that keep full tree/blob data. 0 = unlimited. */
  retentionDepth: number;
  /** GroupId of a repo pinned to the top of the homepage. Empty = none. */
  pinnedRepo: string;
};

/** Caller's role on this platform instance. */
export type PlatformRole = 'admin' | 'writer' | 'visitor';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: PlatformSettings = {
  openCreation: true,
  writers: [],
  platformName: '',
  platformDescription: '',
  retentionDepth: 50,
  pinnedRepo: '',
};

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

/** Read platform settings from KV. Returns defaults if not set. */
export async function getPlatformSettings(kv: KVNamespace): Promise<PlatformSettings> {
  const raw = await kv.get(PLATFORM_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformSettings>;
    return {
      openCreation: parsed.openCreation ?? DEFAULT_SETTINGS.openCreation,
      writers: Array.isArray(parsed.writers) ? parsed.writers : DEFAULT_SETTINGS.writers,
      platformName: parsed.platformName ?? DEFAULT_SETTINGS.platformName,
      platformDescription: parsed.platformDescription ?? DEFAULT_SETTINGS.platformDescription,
      retentionDepth: parsed.retentionDepth ?? DEFAULT_SETTINGS.retentionDepth,
      pinnedRepo: parsed.pinnedRepo ?? DEFAULT_SETTINGS.pinnedRepo,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Write platform settings to KV. */
export async function putPlatformSettings(
  kv: KVNamespace,
  settings: PlatformSettings,
): Promise<void> {
  await kv.put(PLATFORM_SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

/** Check if an address is the platform admin. */
export function isAdmin(env: Env, address: string): boolean {
  const admin = env.PLATFORM_ADMIN;
  if (!admin) return false;
  return admin.toLowerCase() === address.toLowerCase();
}

/** Determine the platform role for an address. */
export async function getRole(
  env: Env,
  kv: KVNamespace,
  address: string | undefined,
): Promise<PlatformRole> {
  if (!address) return 'visitor';
  if (isAdmin(env, address)) return 'admin';
  const settings = await getPlatformSettings(kv);
  const lower = address.toLowerCase();
  if (settings.writers.some((w) => w.toLowerCase() === lower)) return 'writer';
  return 'visitor';
}

/** Check if an address is allowed to create repos. */
export async function canCreateRepo(env: Env, kv: KVNamespace, address: string): Promise<boolean> {
  if (isAdmin(env, address)) return true;
  const settings = await getPlatformSettings(kv);
  if (settings.openCreation) return true;
  const lower = address.toLowerCase();
  return settings.writers.some((w) => w.toLowerCase() === lower);
}
