import { describe, it, expect } from 'vitest';
import { gatewayUrl } from '../../src/config.js';

describe('config', () => {
  describe('gatewayUrl', () => {
    it('returns proxy URL for CID', () => {
      const url = gatewayUrl('QmTestCid');
      expect(url).toBe('/api/ipfs/QmTestCid');
    });

    it('appends path segment', () => {
      const url = gatewayUrl('QmCid', 'subpath/file.txt');
      expect(url).toBe('/api/ipfs/QmCid/subpath/file.txt');
    });

    it('omits trailing slash when path is empty', () => {
      const url = gatewayUrl('QmCid');
      expect(url).not.toMatch(/\/$/);
    });
  });
});
