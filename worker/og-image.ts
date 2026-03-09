// ---------------------------------------------------------------------------
// GitLike — Dynamic OG Image Generator
// Produces branded SVG cards for social media link previews.
// ---------------------------------------------------------------------------

import type { Manifest } from './ipfs.js';

/** Generate an SVG OG image for a repository. */
export function generateRepoOgImage(manifest: Manifest): string {
  const name = escSvg(manifest.name || 'Untitled');
  const desc = escSvg(truncate(manifest.description || 'No description', 120));
  const branchCount = Object.keys(manifest.branches).length;
  const tagCount = manifest.tags ? Object.keys(manifest.tags).length : 0;
  const owner = manifest.acl.owners[0] ?? '';
  const shortOwner = owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : '';
  const isPrivate = manifest.visibility === 'private';

  // Stats pills
  const stats = [
    `🌿 ${branchCount} branch${branchCount !== 1 ? 'es' : ''}`,
    ...(tagCount > 0 ? [`🏷 ${tagCount} tag${tagCount !== 1 ? 's' : ''}`] : []),
    ...(isPrivate ? ['🔒 Private'] : ['🌐 Public']),
  ];
  const statsText = stats.join('   ·   ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0a0e14"/>
      <stop offset="100%" stop-color="#0d1520"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="50%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#f472b6"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="50%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#f472b6"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Top accent line -->
  <rect y="0" width="1200" height="4" fill="url(#accentLine)"/>

  <!-- Grid pattern (subtle) -->
  <g opacity="0.03">
    ${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="630" stroke="#fff" stroke-width="1"/>`).join('\n    ')}
    ${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="1200" y2="${i * 40}" stroke="#fff" stroke-width="1"/>`).join('\n    ')}
  </g>

  <!-- GitLike branding -->
  <text x="80" y="90" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="28" font-weight="800" fill="#60a5fa" letter-spacing="-0.5">
    GitLike
  </text>
  <text x="205" y="90" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="16" fill="#64748b">
    Decentralized VCS
  </text>

  <!-- Repo icon -->
  <g transform="translate(80, 160)">
    <rect width="56" height="56" rx="12" fill="#151b23" stroke="#2a3140" stroke-width="1.5"/>
    <text x="28" y="38" text-anchor="middle" font-size="28">📦</text>
  </g>

  <!-- Repo name -->
  <text x="156" y="195" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="48" font-weight="700" fill="#e2e8f0" letter-spacing="-1">
    ${name}
  </text>

  <!-- Description -->
  <text x="80" y="280" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="24" fill="#94a3b8">
    ${desc}
  </text>

  <!-- Divider -->
  <line x1="80" y1="330" x2="1120" y2="330" stroke="#2a3140" stroke-width="1"/>

  <!-- Stats -->
  <text x="80" y="380" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="22" fill="#64748b">
    ${escSvg(statsText)}
  </text>

  <!-- Owner -->
  <g transform="translate(80, 420)">
    <circle cx="16" cy="16" r="16" fill="#1c2333"/>
    <text x="16" y="22" text-anchor="middle" font-size="16">👤</text>
    <text x="44" y="22" font-family="'Cascadia Code', 'Fira Code', monospace" font-size="18" fill="#60a5fa">
      ${escSvg(shortOwner)}
    </text>
  </g>

  <!-- Bottom bar -->
  <rect y="570" width="1200" height="60" fill="#0d1117"/>
  <text x="80" y="607" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="18" fill="#64748b">
    gitlike.dev
  </text>
  <text x="1120" y="607" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="16" fill="#475569">
    IPFS · Ethereum · Decentralized
  </text>
</svg>`;
}

/** Escape special characters for SVG text content. */
function escSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Truncate text with ellipsis. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
