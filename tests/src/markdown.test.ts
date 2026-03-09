import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/ui/markdown.js';

describe('renderMarkdown', () => {
  it('renders h1 headings', () => {
    expect(renderMarkdown('# Hello')).toContain('<h1>Hello</h1>');
  });

  it('renders h2 through h6', () => {
    expect(renderMarkdown('## Two')).toContain('<h2>Two</h2>');
    expect(renderMarkdown('### Three')).toContain('<h3>Three</h3>');
    expect(renderMarkdown('#### Four')).toContain('<h4>Four</h4>');
    expect(renderMarkdown('##### Five')).toContain('<h5>Five</h5>');
    expect(renderMarkdown('###### Six')).toContain('<h6>Six</h6>');
  });

  it('renders bold text', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders bold+italic', () => {
    const html = renderMarkdown('***both***');
    expect(html).toContain('<strong><em>both</em></strong>');
  });

  it('renders links', () => {
    const html = renderMarkdown('[click](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>click</a>');
  });

  it('renders images', () => {
    const html = renderMarkdown('![alt](https://img.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://img.png"');
    expect(html).toContain('alt="alt"');
  });

  it('renders code blocks', () => {
    const html = renderMarkdown('```js\nconsole.log(1)\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('console.log(1)');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('use `foo()` here')).toContain('<code>foo()</code>');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> quoted text');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('quoted text');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- item one\n- item two');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
    expect(html).toContain('<ul>');
  });

  it('escapes HTML to prevent XSS', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('returns empty-ish output for empty input', () => {
    const html = renderMarkdown('');
    expect(html).toBe('');
  });

  it('renders inline HTML <img> tags', () => {
    const html = renderMarkdown(
      '<img width="468" height="465" alt="pressboard" src="https://github.com/user-attachments/assets/abc123" />',
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="https://github.com/user-attachments/assets/abc123"');
    expect(html).toContain('alt="pressboard"');
    expect(html).toContain('width="468"');
    expect(html).toContain('height="465"');
  });

  it('strips inline HTML <img> with unsafe src', () => {
    const html = renderMarkdown('<img src="javascript:alert(1)" alt="xss" />');
    expect(html).not.toContain('<img');
  });

  it('applies resolveImage to inline HTML <img> src', () => {
    const html = renderMarkdown('<img src="photo.png" alt="pic" />', () => 'https://cdn/photo.png');
    expect(html).toContain('src="https://cdn/photo.png"');
  });
});
