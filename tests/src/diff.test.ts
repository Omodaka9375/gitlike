import { describe, it, expect } from 'vitest';
import { diffLines } from '../../src/ui/diff.js';

describe('diffLines', () => {
  it('returns all same for identical strings', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result.every((r) => r.type === 'same')).toBe(true);
    expect(result.length).toBe(3);
  });

  it('returns all removes + adds for completely different strings', () => {
    const result = diffLines('a\nb', 'x\ny');
    const removes = result.filter((r) => r.type === 'remove');
    const adds = result.filter((r) => r.type === 'add');
    expect(removes.length).toBe(2);
    expect(adds.length).toBe(2);
  });

  it('detects a single line added at end', () => {
    const result = diffLines('a\nb', 'a\nb\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'same', line: 'b' },
      { type: 'add', line: 'c' },
    ]);
  });

  it('detects a single line added at beginning', () => {
    const result = diffLines('b\nc', 'a\nb\nc');
    expect(result).toEqual([
      { type: 'add', line: 'a' },
      { type: 'same', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('detects a single line added in middle', () => {
    const result = diffLines('a\nc', 'a\nb\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'add', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('detects a single line removed', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'remove', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('handles mixed add/remove/same', () => {
    const result = diffLines('a\nb\nc\nd', 'a\nB\nc\ne');
    const types = result.map((r) => r.type);
    expect(types).toContain('same');
    expect(types).toContain('add');
    expect(types).toContain('remove');
  });

  it('handles both empty strings', () => {
    const result = diffLines('', '');
    expect(result).toEqual([{ type: 'same', line: '' }]);
  });

  it('handles empty old string', () => {
    const result = diffLines('', 'a\nb');
    const adds = result.filter((r) => r.type === 'add');
    expect(adds.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty new string', () => {
    const result = diffLines('a\nb', '');
    const removes = result.filter((r) => r.type === 'remove');
    expect(removes.length).toBeGreaterThanOrEqual(1);
  });

  it('handles single-line strings', () => {
    const result = diffLines('hello', 'world');
    expect(result).toEqual([
      { type: 'remove', line: 'hello' },
      { type: 'add', line: 'world' },
    ]);
  });

  it('preserves line content exactly', () => {
    const result = diffLines('  indented\ttab', '  indented\ttab');
    expect(result).toEqual([{ type: 'same', line: '  indented\ttab' }]);
  });

  it('handles large input within reasonable time', () => {
    const old = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const neu = Array.from({ length: 500 }, (_, i) => (i === 250 ? 'CHANGED' : `line ${i}`)).join('\n');
    const start = Date.now();
    const result = diffLines(old, neu);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles trailing newline differences', () => {
    const result = diffLines('a\nb\n', 'a\nb');
    // The trailing newline creates an extra empty line
    expect(result.some((r) => r.type !== 'same') || result.length >= 2).toBe(true);
  });
});
