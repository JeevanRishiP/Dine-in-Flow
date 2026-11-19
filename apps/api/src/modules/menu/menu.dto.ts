import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ─── Shared ───────────────────────────────────────────────────────────────────

const I18nField = z.record(z.string()).default({});

const VegType = z.enum(['VEG', 'NON_VEG', 'EGG', 'VEGAN']);

// ─── Category DTOs ────────────────────────────────────────────────────────────

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  name_i18n: I18nField.optional(),
  outlet_id: z.string().uuid().optional(),
  sort_order: z.number().int().min(0).default(0),
  is_active: z.boolean().optional(),
}).strict();

export const UpdateCategorySchema = CreateCategorySchema.partial().strict();

export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}

// ─── Item DTOs ────────────────────────────────────────────────────────────────

const SafeImageUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (val) =>
      val.startsWith('/api/v1/public/menu/photos/') ||
      val.startsWith('https://') ||
      val.startsWith('http://localhost:') ||
      val.startsWith('http://127.0.0.1:'),
    { message: 'Photo URL must be an https:// URL or an uploaded menu photo path.' },
  );

export const CreateMenuItemSchema = z.object({
  name: z.string().min(1).max(200),
  name_i18n: I18nField.optional(),
  description_i18n: I18nField.optional(),
  category_id: z.string().uuid(),
  outlet_id: z.string().uuid().optional(),
  price_paise: z.number().int().positive(),      // MUST be positive integer paise — AGENTS §2 rule 1
  veg_type: VegType.default('VEG'),
  allergens: z.array(z.string()).default([]),
  is_available: z.boolean().default(true),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).default(0),
  prep_time_min: z.number().int().min(0).nullable().optional(),
  calories: z.number().int().min(0).nullable().optional(),
  spice_level: z.number().int().min(0).max(5).default(0),
  rating: z.number().min(1).max(5).default(4.8),
  orders_count: z.number().int().min(0).default(0),
  allow_half_portion: z.boolean().default(false),
  half_price_paise: z.number().int().positive().nullable().optional(),
  image_url: SafeImageUrl.nullable().optional(),
}).strict();

export const UpdateMenuItemSchema = CreateMenuItemSchema.partial().strict();

export const UploadMenuPhotoSchema = z.object({
  data_url: z.string().trim().min(20).max(10_000_000),
}).strict();

export const StockUpdateSchema = z.object({
  is_available: z.boolean(),
}).strict();

export class CreateMenuItemDto extends createZodDto(CreateMenuItemSchema) {}
export class UpdateMenuItemDto extends createZodDto(UpdateMenuItemSchema) {}
export class UploadMenuPhotoDto extends createZodDto(UploadMenuPhotoSchema) {}
export class StockUpdateDto extends createZodDto(StockUpdateSchema) {}

// ─── Modifier Group DTOs ──────────────────────────────────────────────────────

export const CreateModifierGroupSchema = z.object({
  outlet_id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  name_i18n: I18nField.optional(),
  selection_type: z.enum(['SINGLE', 'MULTIPLE', 'MULTI']).default('SINGLE'),
  min_selections: z.number().int().min(0).optional(),
  max_selections: z.number().int().min(1).optional(),
  min_select: z.number().int().min(0).optional(),
  max_select: z.number().int().min(1).optional(),
  is_required: z.boolean().default(false),
  sort_order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
}).strict().refine(
  (d) => {
    const min = d.min_select ?? d.min_selections ?? 0;
    const max = d.max_select ?? d.max_selections ?? 1;
    return max >= min;
  },
  { message: 'max_selections must be >= min_selections', path: ['max_selections'] },
);

export const UpdateModifierGroupSchema = z.object({
  outlet_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100).optional(),
  name_i18n: I18nField.optional(),
  selection_type: z.enum(['SINGLE', 'MULTIPLE', 'MULTI']).optional(),
  min_selections: z.number().int().min(0).optional(),
  max_selections: z.number().int().min(1).optional(),
  min_select: z.number().int().min(0).optional(),
  max_select: z.number().int().min(1).optional(),
  is_required: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
}).strict();

export const CreateModifierSchema = z.object({
  group_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  name_i18n: I18nField.optional(),
  price_paise: z.number().int().min(0).default(0),
  is_default: z.boolean().default(false),
  is_available: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
}).strict();

export const UpdateModifierSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  name_i18n: I18nField.optional(),
  price_paise: z.number().int().min(0).optional(),
  is_default: z.boolean().optional(),
  is_available: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
}).strict();

export const ModifierGroupQuerySchema = z.object({
  outlet_id: z.string().uuid().optional(),
}).strict();

export class CreateModifierGroupDto extends createZodDto(CreateModifierGroupSchema) {}
export class UpdateModifierGroupDto extends createZodDto(UpdateModifierGroupSchema) {}
export class CreateModifierDto extends createZodDto(CreateModifierSchema) {}
export class UpdateModifierDto extends createZodDto(UpdateModifierSchema) {}
export class ModifierGroupQueryDto extends createZodDto(ModifierGroupQuerySchema) {}

// ─── Query DTOs ───────────────────────────────────────────────────────────────

export const MenuQuerySchema = z.object({
  outlet_id: z.string().uuid().optional(),
  veg_only: z.coerce.boolean().optional(),
  q: z.string().max(100).optional(),
  category_id: z.string().uuid().optional(),
}).strict();

export class MenuQueryDto extends createZodDto(MenuQuerySchema) {}

// ─── Parse helpers (used by tests and services) ─────────────────────────────

export const parseCreateCategoryDto = (input: unknown) =>
  CreateCategorySchema.parse(input);

export const parseCreateMenuItemDto = (input: unknown) =>
  CreateMenuItemSchema.parse(input);

export const parseCreateModifierGroupDto = (input: unknown) =>
  CreateModifierGroupSchema.parse(input);

