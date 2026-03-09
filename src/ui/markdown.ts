// ---------------------------------------------------------------------------
// GitLike — Lightweight Markdown Renderer
// Converts a subset of Markdown to HTML (no dependencies).
// ---------------------------------------------------------------------------

/**
 * Convert markdown text to sanitized HTML.
 * @param resolveImage Optional callback to rewrite image src URLs (e.g. resolve relative paths).
 */
export function renderMarkdown(md: string, resolveImage?: (src: string) => string | null): string {
  // Shield inline HTML <img> tags before escaping (sanitize + placeholder)
  const htmlImages: string[] = [];
  md = md.replace(/<img\s+([^>]*?)\/?>/gi, (_m, attrsStr: string) => {
    const attrs: Record<string, string> = {};
    const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(attrsStr))) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3];
    }
    const src = attrs.src;
    if (!src || !isSafeUrl(src)) return '';
    const resolved = resolveImage ? (resolveImage(src) ?? src) : src;
    const safe: string[] = [`src="${escapeHtml(resolved)}"`, 'style="max-width:100%"'];
    if (attrs.alt) safe.push(`alt="${escapeHtml(attrs.alt)}"`);
    if (attrs.width) safe.push(`width="${escapeHtml(attrs.width)}"`);
    if (attrs.height) safe.push(`height="${escapeHtml(attrs.height)}"`);
    const idx = htmlImages.length;
    htmlImages.push(`<img ${safe.join(' ')}>`);
    return `\x00HTMLIMG${idx}\x00`;
  });

  let html = escapeHtml(md);

  // Shield code blocks — extract, replace with placeholders, restore at the end
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Images (before links to avoid conflict)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    if (!isSafeUrl(src)) return '';
    const resolved = resolveImage ? (resolveImage(src) ?? src) : src;
    return `<img alt="${alt}" src="${resolved}" style="max-width:100%">`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) =>
    isSafeUrl(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text,
  );

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // Tables (GFM-style: header | separator | body rows)
  html = html.replace(/^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm, (_m, headerLine, bodyBlock) => {
    const parseRow = (row: string) =>
      row
        .replace(/^\|\s?|\s?\|$/g, '')
        .split('|')
        .map((c) => c.trim());
    const ths = parseRow(headerLine)
      .map((h) => `<th>${h}</th>`)
      .join('');
    const rows = bodyBlock
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (row: string) =>
          `<tr>${parseRow(row)
            .map((c: string) => `<td>${c}</td>`)
            .join('')}</tr>`,
      )
      .join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Unordered lists — use temp markers to avoid collision with ordered lists
  html = html.replace(/^[ \t]*[-*]\s+(.+)$/gm, '<uli>$1</uli>');
  html = html.replace(
    /(<uli>.*<\/uli>\n?)+/g,
    (match) => `<ul>${match.replace(/<uli>/g, '<li>').replace(/<\/uli>/g, '</li>')}</ul>`,
  );

  // Ordered lists — use temp markers, then wrap in <ol>
  html = html.replace(/^[ \t]*\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
  html = html.replace(
    /(<oli>.*<\/oli>\n?)+/g,
    (match) => `<ol>${match.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>')}</ol>`,
  );

  // Paragraphs: wrap remaining loose lines
  html = html.replace(/^(?!<[a-z\x00])((?!<\/)[^\n]+)$/gm, '<p>$1</p>');

  // Clean up double-wrapped
  html = html.replace(/<p><(h[1-6]|ul|ol|li|pre|blockquote|hr|table)/g, '<$1');
  html = html.replace(/<\/(h[1-6]|ul|ol|li|pre|blockquote|table)><\/p>/g, '</$1>');

  // Restore code blocks and inline HTML images
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);
  html = html.replace(/\x00HTMLIMG(\d+)\x00/g, (_m, idx) => htmlImages[parseInt(idx, 10)]);

  return html;
}

/** Reject dangerous URL schemes (javascript:, vbscript:, data:text/html). */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:')) return false;
  if (trimmed.startsWith('data:') && !trimmed.startsWith('data:image/')) return false;
  return true;
}

/** Escape HTML entities. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
