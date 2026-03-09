import { describe, it, expect } from 'vitest';
import { mimeType } from '../../worker-pages/mime.js';

describe('mimeType', () => {
  it('returns text/html for .html', () => {
    expect(mimeType('index.html')).toBe('text/html; charset=utf-8');
  });

  it('returns text/html for .htm', () => {
    expect(mimeType('page.htm')).toBe('text/html; charset=utf-8');
  });

  it('returns text/css for .css', () => {
    expect(mimeType('styles/main.css')).toBe('text/css; charset=utf-8');
  });

  it('returns application/javascript for .js', () => {
    expect(mimeType('bundle.js')).toBe('application/javascript; charset=utf-8');
  });

  it('returns application/javascript for .mjs', () => {
    expect(mimeType('module.mjs')).toBe('application/javascript; charset=utf-8');
  });

  it('returns application/json for .json', () => {
    expect(mimeType('data.json')).toBe('application/json; charset=utf-8');
  });

  it('returns image/svg+xml for .svg', () => {
    expect(mimeType('logo.svg')).toBe('image/svg+xml');
  });

  it('returns image/png for .png', () => {
    expect(mimeType('photo.png')).toBe('image/png');
  });

  it('returns image/jpeg for .jpg and .jpeg', () => {
    expect(mimeType('photo.jpg')).toBe('image/jpeg');
    expect(mimeType('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns font types for woff/woff2/ttf', () => {
    expect(mimeType('font.woff')).toBe('font/woff');
    expect(mimeType('font.woff2')).toBe('font/woff2');
    expect(mimeType('font.ttf')).toBe('font/ttf');
  });

  it('returns application/wasm for .wasm', () => {
    expect(mimeType('app.wasm')).toBe('application/wasm');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(mimeType('file.xyz')).toBe('application/octet-stream');
    expect(mimeType('binary.bin')).toBe('application/octet-stream');
  });

  it('handles nested paths correctly', () => {
    expect(mimeType('assets/css/main.css')).toBe('text/css; charset=utf-8');
    expect(mimeType('dist/js/bundle.min.js')).toBe('application/javascript; charset=utf-8');
  });

  it('is case-insensitive on extension', () => {
    expect(mimeType('IMAGE.PNG')).toBe('image/png');
    expect(mimeType('Style.CSS')).toBe('text/css; charset=utf-8');
  });

  it('returns octet-stream for files with no extension', () => {
    expect(mimeType('Makefile')).toBe('application/octet-stream');
  });

  it('returns text/markdown for .md', () => {
    expect(mimeType('README.md')).toBe('text/markdown; charset=utf-8');
  });
});
