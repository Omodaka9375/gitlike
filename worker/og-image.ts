// ---------------------------------------------------------------------------
// GitLike — Dynamic OG Image Generator
// Produces branded PNG cards for social media link previews.
// Uses resvg WASM to render SVG → PNG (social crawlers reject SVG).
// ---------------------------------------------------------------------------

import { Resvg } from '@cf-wasm/resvg/workerd';
import type { Manifest } from './ipfs.js';

// ---------------------------------------------------------------------------
// Font loading — Workers have no system fonts, so we fetch Inter from
// Google Fonts and cache it in KV.
// ---------------------------------------------------------------------------

/** Google Fonts CDN URLs for Inter (static, stable). */
const INTER_REGULAR =
  'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.ttf';
const INTER_BOLD =
  'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf';

/** In-memory font cache (survives across requests in the same isolate). */
let _fontCache: Uint8Array[] | null = null;

/** Load Inter font files, cached in memory then KV. */
async function loadFonts(kv: KVNamespace): Promise<Uint8Array[]> {
  if (_fontCache) return _fontCache;

  // Try KV cache
  const kvKey = 'og:fonts:inter';
  const cached = await kv.get(kvKey, 'arrayBuffer');
  if (cached) {
    // KV stores both fonts concatenated with a 4-byte length prefix for the first
    const view = new DataView(cached);
    const len1 = view.getUint32(0);
    const font1 = new Uint8Array(cached, 4, len1);
    const font2 = new Uint8Array(cached, 4 + len1);
    _fontCache = [font1, font2];
    return _fontCache;
  }

  // Fetch from CDN
  const [r1, r2] = await Promise.all([fetch(INTER_REGULAR), fetch(INTER_BOLD)]);
  if (!r1.ok || !r2.ok) throw new Error('Failed to fetch Inter font');
  const f1 = new Uint8Array(await r1.arrayBuffer());
  const f2 = new Uint8Array(await r2.arrayBuffer());
  _fontCache = [f1, f2];

  // Store in KV (concat with length prefix) — 30 day TTL
  const buf = new ArrayBuffer(4 + f1.length + f2.length);
  new DataView(buf).setUint32(0, f1.length);
  new Uint8Array(buf).set(f1, 4);
  new Uint8Array(buf).set(f2, 4 + f1.length);
  await kv.put(kvKey, buf, { expirationTtl: 30 * 86400 });

  return _fontCache;
}

// ---------------------------------------------------------------------------
// SVG icon paths (replace emoji which need emoji fonts)
// ---------------------------------------------------------------------------

/** Branch icon (git-branch style). */
const ICON_BRANCH = `<path d="M6 3v6.5a3.5 3.5 0 0 0 3.5 3.5H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="6" cy="3" r="2" fill="currentColor"/><circle cx="6" cy="14" r="2" fill="currentColor"/><circle cx="14" cy="14" r="2" fill="currentColor"/>`;

/** Tag icon. */
const ICON_TAG = `<path d="M3 3h6l8 8-6 6-8-8V3z" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/>`;

/** Lock icon. */
const ICON_LOCK = `<rect x="4" y="8" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 8V5a3 3 0 0 1 6 0v3" stroke="currentColor" stroke-width="1.5" fill="none"/>`;

/** Globe icon. */
const ICON_GLOBE = `<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M2 10h16M10 2c2.5 3 2.5 13 0 16M10 2c-2.5 3-2.5 13 0 16" stroke="currentColor" stroke-width="1.5" fill="none"/>`;

/** Repo icon (box/package). */
const ICON_REPO = `<path d="M4 4h16v16H4z" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M4 10h16M12 4v16" stroke="currentColor" stroke-width="1.5" fill="none"/>`;

/** User icon. */
const ICON_USER = `<circle cx="10" cy="7" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M2 19c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>`;

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

/** Font family string used in the SVG. Must match the loaded Inter font. */
const FONT = 'Inter, sans-serif';

/** Generate an SVG OG image for a repository. */
export function generateRepoOgImage(manifest: Manifest): string {
  const name = escSvg(manifest.name || 'Untitled');
  const desc = escSvg(truncate(manifest.description || 'No description', 120));
  const branchCount = Object.keys(manifest.branches).length;
  const tagCount = manifest.tags ? Object.keys(manifest.tags).length : 0;
  const owner = manifest.acl.owners[0] ?? '';
  const shortOwner = owner ? `${owner.slice(0, 6)}...${owner.slice(-4)}` : '';
  const isPrivate = manifest.visibility === 'private';

  // Build stats section with SVG icons
  let statsX = 80;
  let statsIcons = '';

  // Branch stat
  statsIcons += `<g transform="translate(${statsX}, 358)" color="#64748b">${ICON_BRANCH}</g>`;
  statsX += 22;
  statsIcons += `<text x="${statsX}" y="375" font-family="${FONT}" font-size="20" fill="#64748b">${branchCount} branch${branchCount !== 1 ? 'es' : ''}</text>`;
  statsX += 12 * `${branchCount} branch${branchCount !== 1 ? 'es' : ''}`.length + 30;

  // Tag stat (only if tags exist)
  if (tagCount > 0) {
    statsIcons += `<g transform="translate(${statsX}, 358)" color="#64748b">${ICON_TAG}</g>`;
    statsX += 22;
    statsIcons += `<text x="${statsX}" y="375" font-family="${FONT}" font-size="20" fill="#64748b">${tagCount} tag${tagCount !== 1 ? 's' : ''}</text>`;
    statsX += 12 * `${tagCount} tag${tagCount !== 1 ? 's' : ''}`.length + 30;
  }

  // Visibility stat
  const visIcon = isPrivate ? ICON_LOCK : ICON_GLOBE;
  const visText = isPrivate ? 'Private' : 'Public';
  statsIcons += `<g transform="translate(${statsX}, 358)" color="#64748b">${visIcon}</g>`;
  statsX += 22;
  statsIcons += `<text x="${statsX}" y="375" font-family="${FONT}" font-size="20" fill="#64748b">${visText}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0a0e14"/>
      <stop offset="100%" stop-color="#0d1520"/>
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
  <text x="80" y="90" font-family="${FONT}" font-size="28" font-weight="700" fill="#60a5fa" letter-spacing="-0.5">GitLike</text>
  <text x="205" y="90" font-family="${FONT}" font-size="16" fill="#64748b">Decentralized VCS</text>

  <!-- Repo icon -->
  <g transform="translate(80, 150)">
    <rect width="56" height="56" rx="12" fill="#151b23" stroke="#2a3140" stroke-width="1.5"/>
    <g transform="translate(10, 10) scale(1.8)" color="#60a5fa">${ICON_REPO}</g>
  </g>

  <!-- Repo name -->
  <text x="156" y="190" font-family="${FONT}" font-size="48" font-weight="700" fill="#e2e8f0" letter-spacing="-1">${name}</text>

  <!-- Description -->
  <text x="80" y="270" font-family="${FONT}" font-size="24" fill="#94a3b8">${desc}</text>

  <!-- Divider -->
  <line x1="80" y1="320" x2="1120" y2="320" stroke="#2a3140" stroke-width="1"/>

  <!-- Stats -->
  ${statsIcons}

  <!-- Owner -->
  <g transform="translate(80, 420)">
    <circle cx="16" cy="16" r="16" fill="#1c2333"/>
    <g transform="translate(6, 4) scale(0.9)" color="#94a3b8">${ICON_USER}</g>
    <text x="44" y="22" font-family="${FONT}" font-size="18" fill="#60a5fa">${escSvg(shortOwner)}</text>
  </g>

  <!-- Bottom bar -->
  <rect y="570" width="1200" height="60" fill="#0d1117"/>
  <text x="80" y="607" font-family="${FONT}" font-size="18" fill="#64748b">gitlike.dev</text>
  <text x="1120" y="607" text-anchor="end" font-family="${FONT}" font-size="16" fill="#475569">IPFS  ·  Ethereum  ·  Decentralized</text>
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

/** Render a repository OG image as PNG bytes. Loads Inter font on first call. */
export async function renderOgPng(manifest: Manifest, kv: KVNamespace): Promise<Uint8Array> {
  const fonts = await loadFonts(kv);
  const svg = generateRepoOgImage(manifest);
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: 1200 },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

/** Truncate text with ellipsis. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}
