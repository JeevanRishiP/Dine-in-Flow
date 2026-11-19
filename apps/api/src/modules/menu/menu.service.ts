import { Injectable } from '@nestjs/common';
import { getPool, withTenantContext } from '../../db/client.js';
import { getRedis } from '../../common/redis/redis.client.js';
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
  UpdateModifierGroupDto,
  CreateModifierDto,
  UpdateModifierDto,
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
      const sql = outletId
        ? `SELECT id, name, name_i18n, outlet_id, sort_order, is_active, created_at
           FROM menu_categories
           WHERE org_id = $1
             AND is_active = true
             AND (outlet_id IS NULL OR outlet_id = $2)
           ORDER BY sort_order, name`
        : `SELECT id, name, name_i18n, outlet_id, sort_order, is_active, created_at
           FROM menu_categories
           WHERE org_id = $1
             AND is_active = true
           ORDER BY sort_order, name`;
      const params = outletId ? [orgId, outletId] : [orgId];
      const { rows } = await client.query(sql, params);
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
             is_active = COALESCE($5, is_active),
             updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [
          id,
          dto.name ?? null,
          dto.name_i18n ? JSON.stringify(dto.name_i18n) : null,
          dto.sort_order ?? null,
          dto.is_active ?? null,
        ],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_categories', id, 'UPDATE', existing, dto);
      return rows[0] as { id: string };
    });
  }

  async deleteCategory(orgId: string, id: string, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findCategory(client, id);
      // Soft-delete category by setting is_active = false
      const { rows } = await client.query(
        `UPDATE menu_categories
         SET is_active = false, updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_categories', id, 'DELETE', existing, { is_active: false });
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
                mi.spice_level, mi.rating, mi.orders_count, mi.allow_half_portion, mi.half_price_paise,
                mi.image_url, mi.created_at,
                COALESCE(
                  json_agg(
                    json_build_object('key', im.raw_key, 'type', im.media_type, 'status', im.status)
                    ORDER BY im.sort_order
                  ) FILTER (WHERE im.id IS NOT NULL AND im.is_active = true),
                  '[]'
                ) AS media,
                COALESCE(
                  jsonb_agg(DISTINCT
                    jsonb_build_object(
                      'group_id', mg.id,
                      'id', mg.id,
                      'name', mg.name,
                      'name_i18n', mg.name_i18n,
                      'selection_type', mg.selection_type,
                      'min_select', COALESCE(mg.min_select, mg.min_selections, 0),
                      'max_select', COALESCE(mg.max_select, mg.max_selections, 1),
                      'is_required', mg.is_required,
                      'sort_order', img.sort_order,
                      'modifiers', (
                        SELECT jsonb_agg(jsonb_build_object(
                          'id', m2.id,
                          'group_id', m2.group_id,
                          'name', m2.name,
                          'name_i18n', m2.name_i18n,
                          'price_paise', m2.price_paise,
                          'is_default', m2.is_default,
                          'is_available', m2.is_available,
                          'sort_order', m2.sort_order
                        ) ORDER BY m2.sort_order, m2.created_at)
                        FROM modifiers m2 WHERE m2.group_id = mg.id AND m2.is_available = true
                      )
                    )
                  ) FILTER (WHERE mg.id IS NOT NULL),
                  '[]'::jsonb
                ) AS modifier_groups
         FROM menu_items mi
         LEFT JOIN item_media im ON im.item_id = mi.id
         LEFT JOIN item_modifier_groups img ON img.item_id = mi.id
         LEFT JOIN modifier_groups mg ON mg.id = img.group_id AND mg.is_active = true
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
            price_paise, veg_type, allergens, is_available, is_active, sort_order,
            prep_time_min, calories, spice_level, allow_half_portion, half_price_paise, image_url)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id, image_url`,
        [
          orgId, dto.outlet_id ?? null, dto.category_id,
          dto.name, JSON.stringify(dto.name_i18n ?? {}), JSON.stringify(dto.description_i18n ?? {}),
          dto.price_paise, dto.veg_type, dto.allergens ?? [],
          dto.is_available ?? true, dto.is_active ?? true, dto.sort_order ?? 0,
          dto.prep_time_min ?? null, dto.calories ?? null, dto.spice_level ?? 0,
          dto.allow_half_portion ?? false, dto.half_price_paise ?? null,
          dto.image_url ?? null,
        ],
      );
      await this._bumpMenuVersion(client, orgId, dto.outlet_id);
      await this._auditLog(client, orgId, actorId, 'menu_items', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string; image_url?: string | null };
    });
  }

  async updateItem(orgId: string, id: string, dto: UpdateMenuItemDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findItem(client, id);
      if (dto.category_id !== undefined) {
        await this._findCategory(client, dto.category_id);
      }
      const hasImageUrlUpdate = dto.image_url !== undefined;
      const hasHalfPriceUpdate = dto.half_price_paise !== undefined;
      const { rows } = await client.query(
        `UPDATE menu_items
         SET category_id        = COALESCE($2, category_id),
             name               = COALESCE($3, name),
             name_i18n          = COALESCE($4::jsonb, name_i18n),
             description_i18n   = COALESCE($5::jsonb, description_i18n),
             price_paise        = COALESCE($6, price_paise),
             veg_type           = COALESCE($7, veg_type),
             allergens          = COALESCE($8, allergens),
             is_available       = COALESCE($9, is_available),
             is_active          = COALESCE($10, is_active),
             sort_order         = COALESCE($11, sort_order),
             prep_time_min      = COALESCE($12, prep_time_min),
             calories           = COALESCE($13, calories),
             spice_level        = COALESCE($14, spice_level),
             allow_half_portion = COALESCE($15, allow_half_portion),
             half_price_paise   = CASE WHEN $16::boolean THEN $17 ELSE half_price_paise END,
             image_url          = CASE WHEN $18::boolean THEN $19 ELSE image_url END,
             updated_at         = now()
         WHERE id = $1
         RETURNING id, image_url`,
        [
          id,
          dto.category_id ?? null,
          dto.name ?? null,
          dto.name_i18n ? JSON.stringify(dto.name_i18n) : null,
          dto.description_i18n ? JSON.stringify(dto.description_i18n) : null,
          dto.price_paise ?? null,
          dto.veg_type ?? null,
          dto.allergens ?? null,
          dto.is_available ?? null,
          dto.is_active ?? null,
          dto.sort_order ?? null,
          dto.prep_time_min ?? null,
          dto.calories ?? null,
          dto.spice_level ?? null,
          dto.allow_half_portion ?? null,
          hasHalfPriceUpdate,
          dto.half_price_paise ?? null,
          hasImageUrlUpdate,
          dto.image_url ?? null,
        ],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_items', id, 'UPDATE', existing, dto);
      return rows[0] as { id: string; image_url?: string | null };
    });
  }

  async uploadItemPhoto(
    orgId: string,
    itemId: string,
    dataUrl: string,
    actorId: string,
  ): Promise<{ itemId: string; imageUrl: string }> {
    const { mimeType, buffer } = await this.mediaService.sanitizeAndEncodePhoto(dataUrl);
    const version = Date.now();
    const imageUrl = `/api/v1/public/menu/photos/${itemId}?v=${version}`;

    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findItem(client, itemId);

      await client.query(
        `INSERT INTO menu_item_photos (org_id, item_id, mime_type, image_bytes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id) DO UPDATE
           SET mime_type = EXCLUDED.mime_type,
               image_bytes = EXCLUDED.image_bytes,
               updated_at = now()`,
        [orgId, itemId, mimeType, buffer],
      );

      await client.query(
        `UPDATE menu_items SET image_url = $2, updated_at = now() WHERE id = $1`,
        [itemId, imageUrl],
      );

      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_item_photos', itemId, 'PHOTO_UPSERT', null, {
        mimeType,
        sizeBytes: buffer.byteLength,
        imageUrl,
      });

      return { itemId, imageUrl };
    });
  }

  async clearItemPhoto(
    orgId: string,
    itemId: string,
    actorId: string,
  ): Promise<{ itemId: string; imageUrl: null }> {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await this._findItem(client, itemId);

      await client.query(
        `UPDATE menu_items SET image_url = NULL, updated_at = now() WHERE id = $1`,
        [itemId],
      );
      await this._bumpMenuVersion(client, orgId, existing['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'menu_item_photos', itemId, 'PHOTO_CLEAR', null, {
        imageUrl: null,
      });

      return { itemId, imageUrl: null };
    });
  }

  async getPublicPhoto(
    itemId: string,
  ): Promise<{ mimeType: string; buffer: Buffer; updatedAt: Date } | null> {
    const pool = getPool();
    const res = await pool.query<{
      mime_type: string;
      image_bytes: Buffer;
      updated_at: Date;
    }>(
      `SELECT mime_type, image_bytes, updated_at FROM get_public_menu_item_photo($1)`,
      [itemId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      mimeType: row.mime_type,
      buffer: Buffer.isBuffer(row.image_bytes) ? row.image_bytes : Buffer.from(row.image_bytes),
      updatedAt: new Date(row.updated_at),
    };
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

  async listModifierGroups(orgId: string, outletId?: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const params: unknown[] = [orgId];
      let outletFilter = '';
      if (outletId) {
        params.push(outletId);
        outletFilter = `AND (mg.outlet_id IS NULL OR mg.outlet_id = $${params.length})`;
      }
      const { rows } = await client.query(
        `SELECT mg.id, mg.org_id, mg.outlet_id, mg.name, mg.name_i18n, mg.selection_type,
                COALESCE(mg.min_select, mg.min_selections, 0) AS min_select,
                COALESCE(mg.max_select, mg.max_selections, 1) AS max_select,
                mg.is_required, mg.sort_order, mg.is_active, mg.created_at, mg.updated_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', m.id,
                      'group_id', m.group_id,
                      'name', m.name,
                      'name_i18n', m.name_i18n,
                      'price_paise', m.price_paise,
                      'is_default', m.is_default,
                      'is_available', m.is_available,
                      'sort_order', m.sort_order,
                      'created_at', m.created_at
                    ) ORDER BY m.sort_order, m.created_at
                  ) FILTER (WHERE m.id IS NOT NULL),
                  '[]'::jsonb
                ) AS modifiers
         FROM modifier_groups mg
         LEFT JOIN modifiers m ON m.group_id = mg.id
         WHERE mg.org_id = $1 ${outletFilter}
         GROUP BY mg.id
         ORDER BY mg.sort_order, mg.name`,
        params,
      );
      return rows as Record<string, unknown>[];
    });
  }

  async getModifierGroup(orgId: string, groupId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `SELECT mg.id, mg.org_id, mg.outlet_id, mg.name, mg.name_i18n, mg.selection_type,
                COALESCE(mg.min_select, mg.min_selections, 0) AS min_select,
                COALESCE(mg.max_select, mg.max_selections, 1) AS max_select,
                mg.is_required, mg.sort_order, mg.is_active, mg.created_at, mg.updated_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', m.id,
                      'group_id', m.group_id,
                      'name', m.name,
                      'name_i18n', m.name_i18n,
                      'price_paise', m.price_paise,
                      'is_default', m.is_default,
                      'is_available', m.is_available,
                      'sort_order', m.sort_order,
                      'created_at', m.created_at
                    ) ORDER BY m.sort_order, m.created_at
                  ) FILTER (WHERE m.id IS NOT NULL),
                  '[]'::jsonb
                ) AS modifiers
         FROM modifier_groups mg
         LEFT JOIN modifiers m ON m.group_id = mg.id
         WHERE mg.org_id = $1 AND mg.id = $2
         GROUP BY mg.id`,
        [orgId, groupId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Modifier group not found', 404);
      return rows[0] as Record<string, unknown>;
    });
  }

  async createModifierGroup(orgId: string, dto: CreateModifierGroupDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const minVal = dto.min_select ?? dto.min_selections ?? 0;
      const maxVal = dto.max_select ?? dto.max_selections ?? 1;
      const { rows } = await client.query(
        `INSERT INTO modifier_groups
           (org_id, outlet_id, name, name_i18n, selection_type, min_selections, max_selections, min_select, max_select, is_required, sort_order, is_active)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          orgId,
          dto.outlet_id ?? null,
          dto.name,
          JSON.stringify(dto.name_i18n ?? {}),
          dto.selection_type,
          minVal,
          maxVal,
          minVal,
          maxVal,
          dto.is_required,
          dto.sort_order ?? 0,
          dto.is_active ?? true,
        ],
      );
      await this._bumpMenuVersion(client, orgId, dto.outlet_id);
      await this._auditLog(client, orgId, actorId, 'modifier_groups', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as { id: string };
    });
  }

  async updateModifierGroup(orgId: string, groupId: string, dto: UpdateModifierGroupDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const current = await this.getModifierGroup(orgId, groupId);
      const sets: string[] = [];
      const params: unknown[] = [orgId, groupId];

      if (dto.name !== undefined) {
        params.push(dto.name);
        sets.push(`name = $${params.length}`);
      }
      if (dto.name_i18n !== undefined) {
        params.push(JSON.stringify(dto.name_i18n));
        sets.push(`name_i18n = $${params.length}::jsonb`);
      }
      if (dto.selection_type !== undefined) {
        params.push(dto.selection_type);
        sets.push(`selection_type = $${params.length}`);
      }
      if (dto.min_select !== undefined || dto.min_selections !== undefined) {
        const val = dto.min_select ?? dto.min_selections;
        params.push(val);
        sets.push(`min_selections = $${params.length}`);
        sets.push(`min_select = $${params.length}`);
      }
      if (dto.max_select !== undefined || dto.max_selections !== undefined) {
        const val = dto.max_select ?? dto.max_selections;
        params.push(val);
        sets.push(`max_selections = $${params.length}`);
        sets.push(`max_select = $${params.length}`);
      }
      if (dto.is_required !== undefined) {
        params.push(dto.is_required);
        sets.push(`is_required = $${params.length}`);
      }
      if (dto.sort_order !== undefined) {
        params.push(dto.sort_order);
        sets.push(`sort_order = $${params.length}`);
      }
      if (dto.is_active !== undefined) {
        params.push(dto.is_active);
        sets.push(`is_active = $${params.length}`);
      }
      if (dto.outlet_id !== undefined) {
        params.push(dto.outlet_id);
        sets.push(`outlet_id = $${params.length}`);
      }

      if (sets.length === 0) return current;

      sets.push(`updated_at = now()`);
      await client.query(
        `UPDATE modifier_groups SET ${sets.join(', ')} WHERE org_id = $1 AND id = $2`,
        params,
      );
      await this._bumpMenuVersion(client, orgId, current['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'modifier_groups', groupId, 'UPDATE', current, dto);
      return this.getModifierGroup(orgId, groupId);
    });
  }

  async deleteModifierGroup(orgId: string, groupId: string, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const current = await this.getModifierGroup(orgId, groupId);
      await client.query(`DELETE FROM modifier_groups WHERE org_id = $1 AND id = $2`, [orgId, groupId]);
      await this._bumpMenuVersion(client, orgId, current['outlet_id'] as string | undefined);
      await this._auditLog(client, orgId, actorId, 'modifier_groups', groupId, 'DELETE', current, null);
      return { success: true, id: groupId };
    });
  }

  async createModifier(orgId: string, dto: CreateModifierDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      await this.getModifierGroup(orgId, dto.group_id);
      const { rows } = await client.query(
        `INSERT INTO modifiers (org_id, group_id, name, name_i18n, price_paise, is_default, is_available, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         RETURNING id, group_id, name, name_i18n, price_paise, is_default, is_available, sort_order`,
        [
          orgId,
          dto.group_id,
          dto.name,
          JSON.stringify(dto.name_i18n ?? {}),
          dto.price_paise,
          dto.is_default ?? false,
          dto.is_available ?? true,
          dto.sort_order ?? 0,
        ],
      );
      await this._bumpMenuVersion(client, orgId, undefined);
      await this._auditLog(client, orgId, actorId, 'modifiers', (rows[0] as { id: string }).id, 'INSERT', null, dto);
      return rows[0] as Record<string, unknown>;
    });
  }

  async updateModifier(orgId: string, modifierId: string, dto: UpdateModifierDto, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await client.query(
        `SELECT id, group_id, name, price_paise, is_default, is_available, sort_order
         FROM modifiers WHERE org_id = $1 AND id = $2`,
        [orgId, modifierId],
      );
      if (!existing.rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Modifier option not found', 404);

      const sets: string[] = [];
      const params: unknown[] = [orgId, modifierId];

      if (dto.name !== undefined) {
        params.push(dto.name);
        sets.push(`name = $${params.length}`);
      }
      if (dto.name_i18n !== undefined) {
        params.push(JSON.stringify(dto.name_i18n));
        sets.push(`name_i18n = $${params.length}::jsonb`);
      }
      if (dto.price_paise !== undefined) {
        params.push(dto.price_paise);
        sets.push(`price_paise = $${params.length}`);
      }
      if (dto.is_default !== undefined) {
        params.push(dto.is_default);
        sets.push(`is_default = $${params.length}`);
      }
      if (dto.is_available !== undefined) {
        params.push(dto.is_available);
        sets.push(`is_available = $${params.length}`);
      }
      if (dto.sort_order !== undefined) {
        params.push(dto.sort_order);
        sets.push(`sort_order = $${params.length}`);
      }

      if (sets.length > 0) {
        await client.query(
          `UPDATE modifiers SET ${sets.join(', ')} WHERE org_id = $1 AND id = $2`,
          params,
        );
        await this._bumpMenuVersion(client, orgId, undefined);
        await this._auditLog(client, orgId, actorId, 'modifiers', modifierId, 'UPDATE', existing.rows[0], dto);
      }

      const updated = await client.query(
        `SELECT id, group_id, name, name_i18n, price_paise, is_default, is_available, sort_order
         FROM modifiers WHERE org_id = $1 AND id = $2`,
        [orgId, modifierId],
      );
      return updated.rows[0] as Record<string, unknown>;
    });
  }

  async deleteModifier(orgId: string, modifierId: string, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      const existing = await client.query(
        `SELECT id, group_id, name FROM modifiers WHERE org_id = $1 AND id = $2`,
        [orgId, modifierId],
      );
      if (!existing.rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Modifier option not found', 404);
      await client.query(`DELETE FROM modifiers WHERE org_id = $1 AND id = $2`, [orgId, modifierId]);
      await this._bumpMenuVersion(client, orgId, undefined);
      await this._auditLog(client, orgId, actorId, 'modifiers', modifierId, 'DELETE', existing.rows[0], null);
      return { success: true, id: modifierId };
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

  async detachModifierGroup(orgId: string, itemId: string, groupId: string, actorId: string) {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (db as any).session?.client ?? (db as any);
      await client.query(
        `DELETE FROM item_modifier_groups WHERE item_id = $1 AND group_id = $2 AND org_id = $3`,
        [itemId, groupId, orgId],
      );
      await this._bumpMenuVersion(client, orgId, undefined);
      await this._auditLog(client, orgId, actorId, 'item_modifier_groups', itemId, 'DETACH', null, { groupId });
      return { success: true, itemId, groupId };
    });
  }

  // ─── Public menu (ETag-ready) ─────────────────────────────────────────────────

  async getPublicMenu(orgId: string, outletId?: string): Promise<{
    version: string;
    categories: Record<string, unknown>[];
    items: Record<string, unknown>[];
  }> {
    const cacheKey = `menu:public:${orgId}:${outletId ?? 'all'}`;
    if (process.env['NODE_ENV'] !== 'test') {
      try {
        const cached = await getRedis().get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as {
            version: string;
            categories: Record<string, unknown>[];
            items: Record<string, unknown>[];
          };
        }
      } catch {
        // Fallback cleanly to DB on cache read failure
      }
    }

    const menuData = await withTenantContext(orgId, async (db) => {
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
                mi.allow_half_portion, mi.half_price_paise, mi.image_url,
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
                      'group_id', mg.id,
                      'id', mg.id,
                      'name', COALESCE(mg.name, mg.name_i18n->>'en', ''),
                      'name_i18n', mg.name_i18n,
                      'selection_type', mg.selection_type,
                      'min', COALESCE(mg.min_select, mg.min_selections, 0),
                      'max', COALESCE(mg.max_select, mg.max_selections, 1),
                      'min_select', COALESCE(mg.min_select, mg.min_selections, 0),
                      'max_select', COALESCE(mg.max_select, mg.max_selections, 1),
                      'required', mg.is_required,
                      'is_required', mg.is_required,
                      'sort_order', img.sort_order,
                      'modifiers', (
                        SELECT jsonb_agg(jsonb_build_object(
                          'id', m2.id,
                          'group_id', m2.group_id,
                          'name', COALESCE(m2.name, m2.name_i18n->>'en', ''),
                          'name_i18n', m2.name_i18n,
                          'price_paise', m2.price_paise,
                          'is_default', m2.is_default,
                          'is_available', m2.is_available,
                          'sort_order', m2.sort_order
                        ) ORDER BY m2.sort_order, m2.created_at)
                        FROM modifiers m2 WHERE m2.group_id = mg.id AND m2.is_available = true
                      )
                    )
                  ) FILTER (WHERE mg.id IS NOT NULL),
                  '[]'::jsonb
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

    if (process.env['NODE_ENV'] !== 'test') {
      try {
        await getRedis().set(cacheKey, JSON.stringify(menuData), 'EX', 30);
      } catch {
        // Ignore cache write failures
      }
    }

    return menuData;
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
    if (outletId) {
      await client.query(
        `INSERT INTO menu_versions (org_id, outlet_id, version, updated_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (org_id, outlet_id) DO UPDATE
           SET version = menu_versions.version + 1, updated_at = now()`,
        [orgId, outletId],
      );
    } else {
      const { rows } = await client.query(
        `SELECT id FROM outlets WHERE org_id = $1`,
        [orgId],
      );
      for (const outlet of rows) {
        await client.query(
          `INSERT INTO menu_versions (org_id, outlet_id, version, updated_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (org_id, outlet_id) DO UPDATE
             SET version = menu_versions.version + 1, updated_at = now()`,
          [orgId, (outlet as { id: string }).id],
        );
      }
    }
    if (process.env['NODE_ENV'] !== 'test') {
      try {
        const redis = getRedis();
        const keys = [`menu:public:${orgId}:all`];
        if (outletId) {
          keys.push(`menu:public:${orgId}:${outletId}`);
        } else {
          const { rows: outletRows } = await client.query(
            `SELECT id FROM outlets WHERE org_id = $1`,
            [orgId],
          );
          for (const out of outletRows) {
            keys.push(`menu:public:${orgId}:${(out as { id: string }).id}`);
          }
        }
        await redis.del(...keys);
      } catch {
        // Best-effort cache invalidation
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _auditLog(client: any, orgId: string, actorId: string,
    table: string, rowId: string, action: string, before: unknown, after: unknown) {
    const validActor =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
        ? actorId
        : null;
    await client.query(
      `INSERT INTO audit_logs (org_id, actor_id, actor_type, action, resource, resource_id, metadata)
       VALUES ($1, $2, 'staff', $3, $4, $5, $6::jsonb)`,
      [
        orgId,
        validActor,
        action,
        table,
        rowId,
        JSON.stringify({ before, after }),
      ],
    );
  }
}
