import { describe, it, expect } from 'vitest';
import { countToLevel, buildDateGrid } from '../../src/ui/contribution-graph.js';

// ---------------------------------------------------------------------------
// countToLevel
// ---------------------------------------------------------------------------

describe('countToLevel', () => {
  it('returns 0 for no contributions', () => {
    expect(countToLevel(0)).toBe(0);
  });

  it('returns 1 for 1–2 contributions', () => {
    expect(countToLevel(1)).toBe(1);
    expect(countToLevel(2)).toBe(1);
  });

  it('returns 2 for 3–5 contributions', () => {
    expect(countToLevel(3)).toBe(2);
    expect(countToLevel(5)).toBe(2);
  });

  it('returns 3 for 6–9 contributions', () => {
    expect(countToLevel(6)).toBe(3);
    expect(countToLevel(9)).toBe(3);
  });

  it('returns 4 for 10+ contributions', () => {
    expect(countToLevel(10)).toBe(4);
    expect(countToLevel(100)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// buildDateGrid
// ---------------------------------------------------------------------------

describe('buildDateGrid', () => {
  it('returns 53 weeks', () => {
    const grid = buildDateGrid();
    expect(grid).toHaveLength(53);
  });

  it('each week has 7 entries', () => {
    const grid = buildDateGrid();
    for (const week of grid) {
      expect(week).toHaveLength(7);
    }
  });

  it('today is included as a non-null entry', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const grid = buildDateGrid();
    const allDates = grid.flat().filter((d): d is string => d !== null);
    expect(allDates).toContain(todayStr);
  });

  it('does not contain dates in the future', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${y}-${m}-${d}`;

    const grid = buildDateGrid();
    const allDates = grid.flat().filter((d): d is string => d !== null);
    expect(allDates).not.toContain(tomorrowStr);
  });

  it('spans roughly 365 days', () => {
    const grid = buildDateGrid();
    const allDates = grid.flat().filter((d): d is string => d !== null);

    // Should be between 350 and 371 days (53 weeks × 7 minus future nulls)
    expect(allDates.length).toBeGreaterThanOrEqual(350);
    expect(allDates.length).toBeLessThanOrEqual(371);
  });

  it('dates are in chronological order', () => {
    const grid = buildDateGrid();
    const allDates = grid.flat().filter((d): d is string => d !== null);

    for (let i = 1; i < allDates.length; i++) {
      expect(allDates[i] >= allDates[i - 1]).toBe(true);
    }
  });

  it('first week starts on a Sunday', () => {
    const grid = buildDateGrid();
    const firstDate = grid[0].find((d): d is string => d !== null);
    expect(firstDate).toBeDefined();

    const day = new Date(firstDate! + 'T00:00:00').getDay();
    // Week slot 0 = Sunday, so the first non-null should be Sunday (0)
    // unless the grid starts mid-week
    const firstNonNullIdx = grid[0].findIndex((d) => d !== null);
    expect(firstNonNullIdx).toBe(day);
  });
});
