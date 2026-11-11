import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseCsvRows,
  parseMenuCsv,
  generateQrToken,
} from '../seed-pilot-restaurant.js';

describe('Pilot Onboarding Seeder (Phase 11 Tooling)', () => {
  describe('parseCsvRows (RFC 4180 parsing)', () => {
    it('parses standard unquoted CSV rows', () => {
      const csv = 'category,item_name,price_rupees\nStarters,Paneer Tikka,320';
      const rows = parseCsvRows(csv);
      expect(rows).toEqual([
        ['category', 'item_name', 'price_rupees'],
        ['Starters', 'Paneer Tikka', '320'],
      ]);
    });

    it('handles quoted fields with commas inside', () => {
      const csv = 'item,allergens\nButter Chicken,"DAIRY,NUTS"';
      const rows = parseCsvRows(csv);
      expect(rows).toEqual([
        ['item', 'allergens'],
        ['Butter Chicken', 'DAIRY,NUTS'],
      ]);
    });

    it('handles escaped quotes inside quoted strings', () => {
      const csv = 'col1,col2\n"Chef\'s ""Special""",450';
      const rows = parseCsvRows(csv);
      expect(rows).toEqual([
        ['col1', 'col2'],
        ['Chef\'s "Special"', '450'],
      ]);
    });
  });

  describe('parseMenuCsv & Monetary Invariants', () => {
    it('parses the production pilot-menu.csv seed file accurately', () => {
      const candidates = [
        path.resolve(process.cwd(), 'infra/seeds/pilot-menu.csv'),
        path.resolve(process.cwd(), '../../infra/seeds/pilot-menu.csv'),
      ];
      const pilotCsvPath = candidates.find((c) => fs.existsSync(c)) || candidates[0]!;
      const csvRaw = fs.readFileSync(pilotCsvPath, 'utf8');
      const items = parseMenuCsv(csvRaw);

      expect(items.length).toBeGreaterThanOrEqual(15);

      // Verify category distribution
      const categories = new Set(items.map((i) => i.category));
      expect(categories).toContain('Starters');
      expect(categories).toContain('Main Course');
      expect(categories).toContain('Biryani');
      expect(categories).toContain('Breads');
      expect(categories).toContain('Desserts');
      expect(categories).toContain('Beverages');

      // Verify zero floating point paise (AGENTS §2 rule 1)
      for (const item of items) {
        expect(Number.isInteger(item.pricePaise)).toBe(true);
        expect(item.pricePaise).toBeGreaterThan(0);
        expect(item.pricePaise).toBe(Math.round(item.priceRupees * 100));
        expect(['VEG', 'NON_VEG', 'EGG', 'VEGAN']).toContain(item.vegType);
        expect(item.spiceLevel).toBeGreaterThanOrEqual(0);
        expect(item.spiceLevel).toBeLessThanOrEqual(3);
      }
    });

    it('parses complex allergen lists correctly', () => {
      const sample = `category,item_name,price_rupees,veg_type,allergens
Main Course,Butter Chicken,460,NON_VEG,"DAIRY,NUTS"
Starters,Paneer Tikka,320,VEG,DAIRY
Breads,Tandoori Roti,45,VEGAN,GLUTEN`;
      const items = parseMenuCsv(sample);
      expect(items[0]?.allergens).toEqual(['DAIRY', 'NUTS']);
      expect(items[1]?.allergens).toEqual(['DAIRY']);
      expect(items[2]?.allergens).toEqual(['GLUTEN']);
    });

    it('throws error when required columns are missing', () => {
      const invalidHeader = 'item,price\nItem 1,100';
      expect(() => parseMenuCsv(invalidHeader)).toThrowError(
        /missing required columns/i,
      );
    });

    it('throws error when a price is invalid or negative', () => {
      const negativePrice = 'category,item_name,price_rupees\nStarters,Item,-50';
      expect(() => parseMenuCsv(negativePrice)).toThrowError(
        /invalid price/i,
      );
    });
  });

  describe('generateQrToken Cryptographic Invariants (ARCH §5)', () => {
    const secret = 'super-secret-test-key-32-bytes-long!';
    const tableId = '00000000-0000-0000-0000-000000000001';

    it('generates consistent HMAC-SHA256 signature for table and version', () => {
      const sig1 = generateQrToken(secret, tableId, 1);
      const sig2 = generateQrToken(secret, tableId, 1);
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA-256 hex length
    });

    it('instantly changes signature when qr_token_version is bumped', () => {
      const v1Token = generateQrToken(secret, tableId, 1);
      const v2Token = generateQrToken(secret, tableId, 2);
      expect(v1Token).not.toBe(v2Token);
    });

    it('produces different tokens for different tables with same version', () => {
      const otherTableId = '00000000-0000-0000-0000-000000000002';
      const token1 = generateQrToken(secret, tableId, 1);
      const token2 = generateQrToken(secret, otherTableId, 1);
      expect(token1).not.toBe(token2);
    });
  });
});
