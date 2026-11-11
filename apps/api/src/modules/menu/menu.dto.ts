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
}).strict();

export const UpdateCategorySchema = CreateCategorySchema.partial().strict();

export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}

// ─── Item DTOs ────────────────────────────────────────────────────────────────

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
  sort_order: z.number().int().min(0).default(0),
  prep_time_min: z.number().int().min(0).optional(),
  calories: z.number().int().min(0).optional(),
  spice_level: z.number().int().min(0).max(5).default(0),
  rating: z.number().min(1).max(5).default(4.8),
  orders_count: z.number().int().min(0).default(0),
  allow_half_portion: z.boolean().default(false),
  half_price_paise: z.number().int().positive().optional(),
}).strict();

export const UpdateMenuItemSchema = CreateMenuItemSchema.partial().strict();

export const StockUpdateSchema = z.object({
  is_available: z.boolean(),
}).strict();

export class CreateMenuItemDto extends createZodDto(CreateMenuItemSchema) {}
export class UpdateMenuItemDto extends createZodDto(UpdateMenuItemSchema) {}
export class StockUpdateDto extends createZodDto(StockUpdateSchema) {}

// ─── Modifier Group DTOs ──────────────────────────────────────────────────────

export const CreateModifierGroupSchema = z.object({
  name: z.string().min(1).max(100),
  name_i18n: I18nField.optional(),
  selection_type: z.enum(['SINGLE', 'MULTIPLE']).default('SINGLE'),
  min_selections: z.number().int().min(0).default(0),
  max_selections: z.number().int().min(1).default(1),
  is_required: z.boolean().default(false),
}).strict().refine(
  (d) => d.max_selections >= d.min_selections,
  { message: 'max_selections must be >= min_selections', path: ['max_selections'] },
);

export const CreateModifierSchema = z.object({
  group_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  name_i18n: I18nField.optional(),
  price_paise: z.number().int().min(0).default(0),
  sort_order: z.number().int().min(0).default(0),
}).strict();

export class CreateModifierGroupDto extends createZodDto(CreateModifierGroupSchema) {}
export class CreateModifierDto extends createZodDto(CreateModifierSchema) {}

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

