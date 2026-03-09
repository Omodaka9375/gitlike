import { describe, it, expect } from 'vitest';
import { getLicenseText, LICENSE_OPTIONS, LICENSE_NAMES } from '../../worker/licenses.js';
import type { LicenseId } from '../../worker/licenses.js';

// ---------------------------------------------------------------------------
// getLicenseText
// ---------------------------------------------------------------------------

describe('getLicenseText', () => {
  it('returns null for "none"', () => {
    expect(getLicenseText('none')).toBeNull();
  });

  it('returns text for NOL', () => {
    const text = getLicenseText('NOL');
    expect(text).not.toBeNull();
    expect(text).toContain('Nuclear Option License');
  });

  it('returns text for MIT with year and holder', () => {
    const text = getLicenseText('MIT', 2025, 'Alice');
    expect(text).not.toBeNull();
    expect(text).toContain('MIT License');
    expect(text).toContain('2025');
    expect(text).toContain('Alice');
  });

  it('uses default year and holder for MIT', () => {
    const text = getLicenseText('MIT');
    expect(text).not.toBeNull();
    expect(text).toContain('[copyright holder]');
    // Should contain current year
    expect(text).toContain(String(new Date().getFullYear()));
  });

  it('returns text for Apache-2.0', () => {
    const text = getLicenseText('Apache-2.0');
    expect(text).not.toBeNull();
    expect(text).toContain('Apache License');
  });

  it('returns text for GPL-3.0 with year and holder', () => {
    const text = getLicenseText('GPL-3.0', 2024, 'Bob');
    expect(text).not.toBeNull();
    expect(text).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(text).toContain('2024');
    expect(text).toContain('Bob');
  });

  it('returns text for BSD-2-Clause with year and holder', () => {
    const text = getLicenseText('BSD-2-Clause', 2023, 'Charlie');
    expect(text).not.toBeNull();
    expect(text).toContain('BSD 2-Clause');
    expect(text).toContain('2023');
    expect(text).toContain('Charlie');
  });

  it('all non-none licenses return non-empty text', () => {
    for (const id of LICENSE_OPTIONS) {
      if (id === 'none') continue;
      const text = getLicenseText(id);
      expect(text, `${id} should return text`).not.toBeNull();
      expect(text!.length, `${id} should not be empty`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// LICENSE_OPTIONS / LICENSE_NAMES consistency
// ---------------------------------------------------------------------------

describe('LICENSE_OPTIONS and LICENSE_NAMES', () => {
  it('LICENSE_OPTIONS contains expected IDs', () => {
    expect(LICENSE_OPTIONS).toContain('NOL');
    expect(LICENSE_OPTIONS).toContain('MIT');
    expect(LICENSE_OPTIONS).toContain('Apache-2.0');
    expect(LICENSE_OPTIONS).toContain('GPL-3.0');
    expect(LICENSE_OPTIONS).toContain('BSD-2-Clause');
    expect(LICENSE_OPTIONS).toContain('none');
  });

  it('every LICENSE_OPTION has a display name', () => {
    for (const id of LICENSE_OPTIONS) {
      expect(LICENSE_NAMES[id], `${id} should have a display name`).toBeDefined();
      expect(LICENSE_NAMES[id].length).toBeGreaterThan(0);
    }
  });

  it('every LICENSE_NAMES key is in LICENSE_OPTIONS', () => {
    for (const id of Object.keys(LICENSE_NAMES) as LicenseId[]) {
      expect(LICENSE_OPTIONS, `${id} should be in LICENSE_OPTIONS`).toContain(id);
    }
  });

  it('NOL is the first option (default)', () => {
    expect(LICENSE_OPTIONS[0]).toBe('NOL');
  });
});
