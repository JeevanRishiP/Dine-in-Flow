import { Injectable } from '@nestjs/common';
import { withTenantContext } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import { MediaService } from './media.service.js';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateMenuItemDto,
  UpdateMenuItemDto,
  StockUpdateDto,
  CreateModifierGroupDto,
  CreateModifierDto,
  MenuQueryDto,
} from './menu.dto.js';

/**
 * MenuService — all reads/writes happen inside withTenantContext()
 * which sets `app.org_id` for RLS enforcement.
 * Reference: ARCH §7, §13, §16 ; AGENTS §2 rule 2
 */
@Injectable()
export class MenuService {
  constructor(private readonly mediaService: MediaService) {}

  async getPresignedUploadUrl(
    orgId: string, itemId: string,
    contentType: string, mediaType: 'IMAGE' | 'VIDEO', actorId: string,
  ) {
    return this.mediaService.getPresignedUploadUrl(orgId, itemId, contentType, mediaType, actorId);
  }

  // ─── Categories ─────────────────────────────────────────────────────────────

  async getCategories(orgId: string, outletId?: string) {
    return withTenantContext(orgId, async (db) => {
      // Raw SQL via the underlying client from drizzle
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle wraps pg client
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `SELECT id, name, name_i18n, outlet_id, sort_order, is_active, created_at
         FROM menu_categories
         WHERE is_active = true
           AND (outlet_id IS NULL OR outlet_id = $1)
         ORDER BY sort_order, name`,
        [outletId ?? null],
      );
      return rows as Record<string, unknown>[];
    });
  }

  async createCategory(orgId: string, dto: CreateCategoryDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `INSERT INTO menu_categories (org_id, outlet_id, name, name_i18n, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orgId, dto.outlet_id ?? null, dto.name, JSON.stringify(dto.name_i18n ?? {}), dto.sort_order],
      );
      await this._bumpMenuVersion(client, orgId, dto.outlet_id);
      await this._auditLog(client, orgId, actorId, 'menu_categories', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string };
    });
  }

  async updateCategory(orgId: string, id: string, dto: UpdateCategoryDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findCategory(client, id);
      const { rows } = await client.query(
        `UPDATE menu_categories
         SET name = COALESCE($2, name),
             name_i18n = COALESCE($3::jsonb, name_i18n),
             sort_order = COALESCE($4, sort_order),
             updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, dto.name ?? null, dto.name_i18n ? JSON.stringify(dto.name_i18n) : null, dto.sort_order ?? null],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_categories', id, 'UPDATE', existing, dto);
      return rows[0] as { id: string };
    });
  }

  // ─── Menu Items ──────────────────────────────────────────────────────────────

  async getItems(orgId: string, query: MenuQueryDto) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const params: unknown[] = [orgId];
      let where = 'WHERE mi.org_id = $1 AND mi.is_active = true';

      if (query.outlet_id) {
        params.push(query.outlet_id);
        where += ` AND (mi.outlet_id IS NULL OR mi.outlet_id = $${params.length})`;
      }
      if (query.category_id) {
        params.push(query.category_id);
        where += ` AND mi.category_id = $${params.length}`;
      }
      if (query.veg_only) {
        where += ` AND mi.veg_type IN ('VEG', 'VEGAN')`;
      }
      if (query.q) {
        params.push(query.q);
        where += ` AND mi.search_vector @@ plainto_tsquery('simple', $${params.length})`;
      }

      const { rows } = await client.query(
        `SELECT mi.id, mi.category_id, mi.outlet_id, mi.name, mi.name_i18n,
                mi.description_i18n, mi.price_paise, mi.veg_type, mi.allergens,
                mi.is_available, mi.sort_order, mi.prep_time_min, mi.calories,
                mi.spice_level, mi.rating, mi.orders_count, mi.allow_half_portion, mi.half_price_paise, mi.created_at,
                COALESCE(
                  json_agg(
                    json_build_object('key', im.raw_key, 'type', im.media_type, 'status', im.status)
                    ORDER BY im.sort_order
                  ) FILTER (WHERE im.id IS NOT NULL AND im.is_active = true),
                  '[]'
                ) AS media
         FROM menu_items mi
         LEFT JOIN item_media im ON im.item_id = mi.id
         ${where}
         GROUP BY mi.id
         ORDER BY mi.sort_order, mi.name`,
        params,
      );
      return rows as Record<string, unknown>[];
    });
  }

  async createItem(orgId: string, dto: CreateMenuItemDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      await this._findCategory(client, dto.category_id);

      const { rows } = await client.query(
        `INSERT INTO menu_items
           (org_id, outlet_id, category_id, name, name_i18n, description_i18n,
            price_paise, veg_type, allergens, is_available, sort_order,
            prep_time_min, calories, spice_level, allow_half_portion, half_price_paise)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          orgId, dto.outlet_id ?? null, dto.category_id,
          dto.name, JSON.stringify(dto.name_i18n ?? {}), JSON.stringify(dto.description_i18n ?? {}),
          dto.price_paise, dto.veg_type, dto.allergens ?? [],
          dto.is_available ?? true, dto.sort_order ?? 0,
          dto.prep_time_min ?? null, dto.calories ?? null, dto.spice_level ?? 0,
          dto.allow_half_portion ?? false, dto.half_price_paise ?? null,
        ],
      );
      await this._bumpMenuVersion(client, orgId, dto.outlet_id);
      await this._auditLog(client, orgId, actorId, 'menu_items', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string };
    });
  }

  async updateItem(orgId: string, id: string, dto: UpdateMenuItemDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findItem(client, id);
      const { rows } = await client.query(
        `UPDATE menu_items
         SET name             = COALESCE($2, name),
             name_i18n        = COALESCE($3::jsonb, name_i18n),
             description_i18n = COALESCE($4::jsonb, description_i18n),
             price_paise      = COALESCE($5, price_paise),
             veg_type         = COALESCE($6, veg_type),
             allergens        = COALESCE($7, allergens),
             is_available     = COALESCE($8, is_available),
             sort_order       = COALESCE($9, sort_order),
             prep_time_min    = COALESCE($10, prep_time_min),
             calories         = COALESCE($11, calories),
             spice_level      = COALESCE($12, spice_level),
             allow_half_portion = COALESCE($13, allow_half_portion),
             half_price_paise = COALESCE($14, half_price_paise),
             updated_at       = now()
         WHERE id = $1
         RETURNING id`,
        [
          id, dto.name ?? null,
          dto.name_i18n ? JSON.stringify(dto.name_i18n) : null,
          dto.description_i18n ? JSON.stringify(dto.description_i18n) : null,
          dto.price_paise ?? null, dto.veg_type ?? null,
          dto.allergens ?? null, dto.is_available ?? null,
          dto.sort_order ?? null, dto.prep_time_min ?? null,
          dto.calories ?? null, dto.spice_level ?? null,
          dto.allow_half_portion ?? null, dto.half_price_paise ?? null,
        ],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_items', id, 'UPDATE', existing, dto);
      return rows[0] as { id: string };
    });
  }

  async updateStock(orgId: string, id: string, dto: StockUpdateDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findItem(client, id);
      await client.query(
        `UPDATE menu_items SET is_available = $2, updated_at = now() WHERE id = $1`,
        [id, dto.is_available],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_items', id, 'STOCK_UPDATE',
        { is_available: existing['is_available'] }, dto);
    });
  }

  // ─── Modifier Groups ─────────────────────────────────────────────────────────

  async createModifierGroup(orgId: string, dto: CreateModifierGroupDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `INSERT INTO modifier_groups
           (org_id, name, name_i18n, selection_type, min_selections, max_selections, is_required)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)
         RETURNING id`,
        [orgId, dto.name, JSON.stringify(dto.name_i18n ?? {}),
         dto.selection_type, dto.min_selections, dto.max_selections, dto.is_required],
      );
      await this._auditLog(client, orgId, actorId, 'modifier_groups', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string };
    });
  }

  async createModifier(orgId: string, dto: CreateModifierDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `INSERT INTO modifiers (org_id, group_id, name, name_i18n, price_paise, sort_order)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         RETURNING id`,
        [orgId, dto.group_id, dto.name, JSON.stringify(dto.name_i18n ?? {}), dto.price_paise, dto.sort_order],
      );
      await this._auditLog(client, orgId, actorId, 'modifiers', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string };
    });
  }

  async attachModifierGroup(orgId: string, itemId: string, groupId: string, sortOrder: number, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      await client.query(
        `INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, group_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [itemId, groupId, orgId, sortOrder],
      );
      await this._bumpMenuVersion(client, orgId, undefined);
      await this._auditLog(client, orgId, actorId, 'item_modifier_groups', itemId, 'ATTACH', null, { groupId });
    });
  }

  // ─── Public menu (ETag-ready) ─────────────────────────────────────────────────

  async getPublicMenu(orgId: string, outletId?: string): Promise<{
    version: string;
    categories: Record<string, unknown>[];
    items: Record<string, unknown>[];
  }> {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);

      const versionRow = await client.query(
        `SELECT version FROM menu_versions WHERE org_id = $1
           AND (outlet_id = $2 OR outlet_id IS NULL)
         ORDER BY (outlet_id IS NOT NULL) DESC LIMIT 1`,
        [orgId, outletId ?? null],
      );
      const version = (versionRow.rows[0] as { version?: string } | undefined)?.version ?? '0';

      const catRes = await client.query(
        `SELECT id, name, name_i18n, sort_order FROM menu_categories
         WHERE org_id = $1 AND is_active = true AND (outlet_id IS NULL OR outlet_id = $2)
         ORDER BY sort_order`,
        [orgId, outletId ?? null],
      );

      const itemRes = await client.query(
        `SELECT mi.id, mi.category_id, mi.name, mi.name_i18n, mi.description_i18n,
                mi.price_paise, mi.veg_type, mi.allergens, mi.is_available,
                mi.sort_order, mi.prep_time_min, mi.spice_level, mi.rating, mi.orders_count,
                mi.allow_half_portion, mi.half_price_paise,
                COALESCE(
                  json_agg(
                    json_build_object('key', im.processed_key, 'thumb', im.thumbnail_key, 'type', im.media_type)
                    ORDER BY im.sort_order
                  ) FILTER (WHERE im.id IS NOT NULL AND im.status = 'READY' AND im.is_active),
                  '[]'
                ) AS media,
                COALESCE(
                  jsonb_agg(DISTINCT
                    jsonb_build_object(
                      'group_id', mg.id, 'name', mg.name_i18n,
                      'selection_type', mg.selection_type,
                      'min', mg.min_selections, 'max', mg.max_selections,
                      'required', mg.is_required,
                      'modifiers', (
                        SELECT jsonb_agg(jsonb_build_object(
                          'id', m2.id, 'name', m2.name_i18n,
                          'price_paise', m2.price_paise
                        ) ORDER BY m2.sort_order)
                        FROM modifiers m2 WHERE m2.group_id = mg.id AND m2.is_available = true
                      )
                    )
                  ) FILTER (WHERE mg.id IS NOT NULL),
                  '[]'
                ) AS modifier_groups
         FROM menu_items mi
         LEFT JOIN item_media im ON im.item_id = mi.id
         LEFT JOIN item_modifier_groups img ON img.item_id = mi.id
         LEFT JOIN modifier_groups mg ON mg.id = img.group_id AND mg.is_active = true
         WHERE mi.org_id = $1 AND mi.is_active = true
           AND (mi.outlet_id IS NULL OR mi.outlet_id = $2)
         GROUP BY mi.id
         ORDER BY mi.sort_order, mi.name`,
        [orgId, outletId ?? null],
      );

      return {
        version,
        categories: catRes.rows as Record<string, unknown>[],
        items: itemRes.rows as Record<string, unknown>[],
      };
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _findCategory(client: any, id: string): Promise<Record<string, unknown>> {
    const { rows } = await client.query(
      `SELECT id, outlet_id FROM menu_categories WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Category not found', 404);
    return rows[0] as Record<string, unknown>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _findItem(client: any, id: string): Promise<Record<string, unknown>> {
    const { rows } = await client.query(
      `SELECT id, outlet_id, is_available FROM menu_items WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Menu item not found', 404);
    return rows[0] as Record<string, unknown>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _bumpMenuVersion(client: any, orgId: string, outletId: string | undefined) {
    await client.query(
      `INSERT INTO menu_versions (org_id, outlet_id, version, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (org_id, outlet_id) DO UPDATE
         SET version = menu_versions.version + 1, updated_at = now()`,
      [orgId, outletId ?? null],
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _auditLog(client: any, orgId: string, actorId: string,
    table: string, rowId: string, action: string, before: unknown, after: unknown) {
    await client.query(
      `INSERT INTO audit_logs (org_id, actor_id, action, table_name, row_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [orgId, actorId, action, table, rowId, JSON.stringify(before), JSON.stringify(after)],
    );
  }
}
