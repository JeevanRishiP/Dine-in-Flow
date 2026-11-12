import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import type { AiProvider, RetrievedMenuItem } from './ai.provider.js';

interface RawMenuItemRow {
  id: string;
  name: string;
  description_i18n: Record<string, string> | null;
  price_paise: number;
  veg_type: string;
  allergens: string[] | null;
  spice_level: number;
  prep_time_min: number | null;
  calories: number | null;
  is_available: boolean;
  score?: number;
}

@Injectable()
export class MenuRetrievalService {
  private readonly logger = new Logger(MenuRetrievalService.name);

  /**
   * Hybrid retrieval combining pgvector semantic search and keyword text matching.
   * Scoped strictly by org_id and outlet_id with forced RLS.
   * Reference: ARCH §21
   */
  async hybridSearch(
    orgId: string,
    outletId: string,
    query: string,
    queryEmbedding?: number[],
    limit = 8,
  ): Promise<RetrievedMenuItem[]> {
    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // 1. Vector Search (if embedding is available)
      let vectorRows: RawMenuItemRow[] = [];
      if (queryEmbedding && queryEmbedding.length === 768) {
        const vectorLiteral = `[${queryEmbedding.join(',')}]`;
        const vectorQuery = `
          SELECT id, name, description_i18n, price_paise, veg_type, allergens,
                 spice_level, prep_time_min, calories, is_available,
                 (1 - (embedding <=> $1::vector)) AS score
          FROM menu_items
          WHERE org_id = $2
            AND (outlet_id = $3 OR outlet_id IS NULL)
            AND is_active = true
            AND is_available = true
            AND embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $4;
        `;
        try {
          const res = await client.query(vectorQuery, [vectorLiteral, orgId, outletId, limit]);
          vectorRows = res.rows as RawMenuItemRow[];
        } catch (err) {
          this.logger.warn(`[AI] Vector search query failed (pgvector might be disabled in test mock): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 2. Keyword & Text Search
      const cleanKeyword = query.replace(/[^\w\s]/gi, ' ').trim();
      const keywordTerms = cleanKeyword.split(/\s+/).filter(Boolean);
      const searchParam = `%${keywordTerms.join('%')}%`;

      const keywordQuery = `
        SELECT id, name, description_i18n, price_paise, veg_type, allergens,
               spice_level, prep_time_min, calories, is_available
        FROM menu_items
        WHERE org_id = $1
          AND (outlet_id = $2 OR outlet_id IS NULL)
          AND is_active = true
          AND is_available = true
          AND (
            name ILIKE $3
            OR description_i18n::text ILIKE $3
            OR array_to_string(allergens, ' ') ILIKE $3
            OR (search_vector IS NOT NULL AND search_vector @@ plainto_tsquery('english', $4))
          )
        LIMIT $5;
      `;

      let keywordRows: RawMenuItemRow[] = [];
      try {
        const res = await client.query(keywordQuery, [
          orgId,
          outletId,
          searchParam,
          cleanKeyword || query,
          limit,
        ]);
        keywordRows = res.rows as RawMenuItemRow[];
      } catch (err) {
        this.logger.warn(`[AI] Keyword search query failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 3. Merge & Deduplicate (Vector items prioritized, then keyword matches)
      const itemMap = new Map<string, RetrievedMenuItem>();

      for (const row of [...vectorRows, ...keywordRows]) {
        if (!itemMap.has(row.id)) {
          const desc = row.description_i18n?.['en'] || (row.description_i18n ? Object.values(row.description_i18n)[0] : undefined);
          itemMap.set(row.id, {
            id: row.id,
            name: row.name,
            description: desc,
            pricePaise: Number(row.price_paise),
            vegType: row.veg_type,
            allergens: row.allergens || [],
            spiceLevel: Number(row.spice_level) || 0,
            prepTimeMin: row.prep_time_min ? Number(row.prep_time_min) : undefined,
            calories: row.calories ? Number(row.calories) : undefined,
            isAvailable: Boolean(row.is_available),
          });
        }
      }

      // If both searches produced 0 items, fetch top popular active dishes in outlet as context
      if (itemMap.size === 0) {
        const fallbackRes = await client.query(
          `SELECT id, name, description_i18n, price_paise, veg_type, allergens,
                  spice_level, prep_time_min, calories, is_available
           FROM menu_items
           WHERE org_id = $1
             AND (outlet_id = $2 OR outlet_id IS NULL)
             AND is_active = true
             AND is_available = true
           ORDER BY sort_order ASC
           LIMIT $3;`,
          [orgId, outletId, limit],
        );

        for (const row of fallbackRes.rows as RawMenuItemRow[]) {
          const desc = row.description_i18n?.['en'] || (row.description_i18n ? Object.values(row.description_i18n)[0] : undefined);
          itemMap.set(row.id, {
            id: row.id,
            name: row.name,
            description: desc,
            pricePaise: Number(row.price_paise),
            vegType: row.veg_type,
            allergens: row.allergens || [],
            spiceLevel: Number(row.spice_level) || 0,
            prepTimeMin: row.prep_time_min ? Number(row.prep_time_min) : undefined,
            calories: row.calories ? Number(row.calories) : undefined,
            isAvailable: Boolean(row.is_available),
          });
        }
      }

      return Array.from(itemMap.values()).slice(0, limit);
    });
  }

  /**
   * Reindexes embeddings for an outlet's menu items using the provided AiProvider.
   * Reads items in short TX 1, calls external embedding API outside DB TX,
   * and writes updated vectors in short TX 2 to avoid pool starvation.
   * Reference: ARCH §21
   */
  async reindexOutlet(
    orgId: string,
    outletId: string,
    provider: AiProvider,
  ): Promise<{ itemsIndexed: number }> {
    const items = await withTenantContextRaw(orgId, async (client: PoolClient) => {
      const selectRes = await client.query(
        `SELECT id, name, description_i18n, veg_type, allergens, spice_level
         FROM menu_items
         WHERE org_id = $1
           AND (outlet_id = $2 OR outlet_id IS NULL)
           AND is_active = true;`,
        [orgId, outletId],
      );

      return selectRes.rows as Array<{
        id: string;
        name: string;
        description_i18n: Record<string, string> | null;
        veg_type: string;
        allergens: string[] | null;
        spice_level: number;
      }>;
    });

    const updates: Array<{ id: string; vectorLiteral: string }> = [];
    for (const item of items) {
      const desc = item.description_i18n?.['en'] || '';
      const allergens = (item.allergens || []).join(', ');
      const textToEmbed = `${item.name}. ${desc}. Veg Type: ${item.veg_type}. Allergens: ${allergens}. Spice Level: ${item.spice_level}/3.`;

      try {
        const embedding = await provider.generateEmbedding(textToEmbed);
        updates.push({ id: item.id, vectorLiteral: `[${embedding.join(',')}]` });
      } catch (err) {
        this.logger.error(`[AI] Failed to index embedding for item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (updates.length === 0) {
      return { itemsIndexed: 0 };
    }

    await withTenantContextRaw(orgId, async (client: PoolClient) => {
      for (const u of updates) {
        await client.query(
          `UPDATE menu_items
           SET embedding = $1::vector, updated_at = now()
           WHERE id = $2 AND org_id = $3;`,
          [u.vectorLiteral, u.id, orgId],
        );
      }
    });

    return { itemsIndexed: updates.length };
  }
}
