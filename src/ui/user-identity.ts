// ---------------------------------------------------------------------------
// GitLike — User Identity
// Renders avatar (PFP or colored-dot fallback) + display name for addresses.
// ---------------------------------------------------------------------------

import { fetchProfile, fetchAlias } from '../api.js';
import { shortAddr } from './dom.js';

/** Derive a gradient color from an Ethereum address. */
export function addressToColor(addr: string): string {
  const h1 = parseInt(addr.slice(2, 8), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1},70%,55%), hsl(${h2},70%,55%))`;
}

/** Resolve the display name for an address. Returns alias or shortAddr. */
export async function displayName(address: string): Promise<string> {
  const alias = await fetchAlias(address);
  return alias ?? shortAddr(address);
}

/**
 * Populate a DOM element with the display name for an address.
 * Sets textContent to shortAddr immediately, then swaps to alias when resolved.
 */
export function fillDisplayName(el: HTMLElement, address: string): void {
  el.textContent = shortAddr(address);
  fetchAlias(address).then((alias) => {
    if (alias) el.textContent = alias;
  });
}

/**
 * Populate a container with avatar + display name for an address.
 * Renders an <img> PFP (or colored-dot fallback) and a name span.
 * The container should be an inline-flex element (e.g. span or div).
 */
export function fillUserIdentity(
  container: HTMLElement,
  address: string,
  opts: { size?: number; linkToProfile?: boolean } = {},
): void {
  const size = opts.size ?? 16;

  // Immediate: colored dot + shortAddr
  const dot = document.createElement('span');
  dot.className = 'addr-avatar';
  dot.style.cssText = `background: ${addressToColor(address)}; width: ${size}px; height: ${size}px; border-radius: 50%; display: inline-block; flex-shrink: 0;`;

  const nameSpan = document.createElement('span');
  nameSpan.textContent = shortAddr(address);

  container.style.display = 'inline-flex';
  container.style.alignItems = 'center';
  container.style.gap = '0.35rem';
  container.appendChild(dot);
  container.appendChild(nameSpan);

  // Async: swap in real PFP + alias
  fetchProfile(address).then(({ alias, pfp }) => {
    if (alias) nameSpan.textContent = alias;
    if (pfp) {
      const img = document.createElement('img');
      // Use avatar proxy to protect visitor privacy (no direct request to PFP host)
      img.src = `/api/avatar/${address.toLowerCase()}`;
      img.alt = alias || shortAddr(address);
      img.style.cssText = `width: ${size}px; height: ${size}px; border-radius: 50%; object-fit: cover; flex-shrink: 0;`;
      img.onerror = () => {
        // Fallback to colored dot on load failure
        img.replaceWith(dot);
      };
      dot.replaceWith(img);
    }
  });
}
