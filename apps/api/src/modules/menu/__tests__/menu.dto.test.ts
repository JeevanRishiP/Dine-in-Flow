import { describe, it, expect } from 'vitest';
import {
  parseCreateCategoryDto,
  parseCreateMenuItemDto,
  parseCreateModifierGroupDto,
  UpdateMenuItemSchema,
  UploadMenuPhotoSchema,
} from '../menu.dto.js';

/**
 * Unit tests for menu DTOs — validates Zod schemas enforce
 * paise-only pricing (AGENTS §2 rule 1), required fields, strict mode.
 */
describe('Menu DTOs', () => {
  describe('CreateCategoryDto', () => {
    it('accepts valid category', () => {
      const result = parseCreateCategoryDto({ name: 'Starters', sort_order: 0 });
      expect(result.name).toBe('Starters');
    });

    it('rejects empty name', () => {
      expect(() => parseCreateCategoryDto({ name: '' })).toThrow();
    });

    it('rejects sort_order < 0', () => {
      expect(() => parseCreateCategoryDto({ name: 'X', sort_order: -1 })).toThrow();
    });

    it('strips unknown fields (strict)', () => {
      expect(() =>
        parseCreateCategoryDto({ name: 'X', unknown_field: true }),
      ).toThrow();
    });
  });

  describe('CreateMenuItemDto — paise validation (AGENTS §2 rule 1)', () => {
    const base = {
      category_id: 'c1c7f8a2-1234-4abc-abcd-000000000001',
      name: 'Paneer Butter Masala',
      price_paise: 34900, // ₹349.00
      veg_type: 'VEG' as const,
    };

    it('accepts integer paise price', () => {
      const dto = parseCreateMenuItemDto(base);
      expect(dto.price_paise).toBe(34900);
    });

    it('rejects zero price (must be positive)', () => {
      expect(() => parseCreateMenuItemDto({ ...base, price_paise: 0 })).toThrow();
    });

    it('rejects negative price', () => {
      expect(() => parseCreateMenuItemDto({ ...base, price_paise: -100 })).toThrow();
    });

    it('rejects float price — no floating-point money (AGENTS §2 rule 1)', () => {
      expect(() => parseCreateMenuItemDto({ ...base, price_paise: 349.5 })).toThrow();
    });

    it('rejects invalid veg_type', () => {
      expect(() =>
        parseCreateMenuItemDto({ ...base, veg_type: 'PESCATARIAN' as 'VEG' }),
      ).toThrow();
    });

    it('accepts all valid veg_types', () => {
      for (const veg_type of ['VEG', 'VEGAN', 'NON_VEG', 'EGG'] as const) {
        const dto = parseCreateMenuItemDto({ ...base, veg_type });
        expect(dto.veg_type).toBe(veg_type);
      }
    });

    it('accepts optional fields when provided', () => {
      const dto = parseCreateMenuItemDto({
        ...base,
        spice_level: 3,
        prep_time_min: 15,
        allergens: ['GLUTEN', 'DAIRY'],
      });
      expect(dto.spice_level).toBe(3);
      expect(dto.allergens).toEqual(['GLUTEN', 'DAIRY']);
    });

    it('accepts safe image_url paths and rejects javascript: URLs', () => {
      const withHttps = parseCreateMenuItemDto({
        ...base,
        image_url: 'https://images.unsplash.com/photo-123456',
      });
      expect(withHttps.image_url).toBe('https://images.unsplash.com/photo-123456');

      const withLocalPhoto = UpdateMenuItemSchema.parse({
        image_url: '/api/v1/public/menu/photos/11111111-1111-4111-8111-111111111111',
      });
      expect(withLocalPhoto.image_url).toContain('/api/v1/public/menu/photos/');

      expect(() =>
        parseCreateMenuItemDto({ ...base, image_url: 'javascript:alert(1)' }),
      ).toThrow();

      expect(
        UploadMenuPhotoSchema.parse({ data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }).data_url,
      ).toContain('data:image/png');
    });

    it('rejects spice_level > 5', () => {
      expect(() => parseCreateMenuItemDto({ ...base, spice_level: 6 })).toThrow();
    });
  });

  describe('CreateModifierGroupDto', () => {
    const base = {
      name: 'Extra Toppings',
      selection_type: 'MULTIPLE' as const,
      min_selections: 0,
      max_selections: 3,
      is_required: false,
    };

    it('accepts valid modifier group', () => {
      const dto = parseCreateModifierGroupDto(base);
      expect(dto.selection_type).toBe('MULTIPLE');
    });

    it('rejects max_selections < min_selections', () => {
      expect(() =>
        parseCreateModifierGroupDto({ ...base, min_selections: 3, max_selections: 1 }),
      ).toThrow();
    });

    it('accepts single selection type', () => {
      const dto = parseCreateModifierGroupDto({
        name: 'Size',
        selection_type: 'SINGLE',
        min_selections: 1,
        max_selections: 1,
        is_required: true,
      });
      expect(dto.is_required).toBe(true);
    });

    it('rejects unknown fields (strict)', () => {
      expect(() =>
        parseCreateModifierGroupDto({ ...base, extra_field: 'bad' }),
      ).toThrow();
    });
  });
});
