// ---------------------------------------------------------------------------
// GitLike — DOM Helpers
// Minimal utilities for building UI without a framework.
// ---------------------------------------------------------------------------

/** Create an element with optional class, attributes, and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    cls?: string;
    attrs?: Record<string, string>;
    text?: string;
    html?: string;
    children?: (HTMLElement | string)[];
    onclick?: (e: MouseEvent) => void;
    oninput?: (e: Event) => void;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.text) node.textContent = opts.text;
  if (opts.html) node.innerHTML = opts.html;
  if (opts.onclick) node.addEventListener('click', opts.onclick as EventListener);
  if (opts.oninput) node.addEventListener('input', opts.oninput as EventListener);
  if (opts.children) {
    for (const child of opts.children) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** Clear an element's children and append new ones. */
export function render(parent: HTMLElement, ...children: (HTMLElement | string)[]): void {
  parent.innerHTML = '';
  for (const child of children) {
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Show a loading spinner. */
export function spinner(message = 'Loading...'): HTMLElement {
  return el('div', { cls: 'spinner', text: message });
}

/** Show an error message. */
export function errorBox(message: string): HTMLElement {
  return el('div', { cls: 'error-box', text: message });
}

/** Truncate a CID for display. */
export function shortCid(cid: string, len = 8): string {
  if (cid.length <= len * 2) return cid;
  return `${cid.slice(0, len)}…${cid.slice(-len)}`;
}

/** Format an ISO timestamp to a human-readable relative string. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Truncate an address for display: 0xABC...DEF */
export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Extract a short, user-friendly message from an error. */
export function friendlyError(err: unknown): string {
  if (err instanceof Error) {
    // Strip nested JSON blobs from Pinata SDK errors
    const msg = err.message;
    const jsonIdx = msg.indexOf('{');
    if (jsonIdx > 0) return msg.slice(0, jsonIdx).trim().replace(/:$/, '');
    return msg;
  }
  return String(err);
}
