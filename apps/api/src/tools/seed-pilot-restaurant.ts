import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, withTenantContextRaw } from '../db/client.js';
import { hashPassword } from '../modules/auth/crypto.js';
import { getConfig } from '../config/config.js';
import { MockAiAdapter } from '../modules/ai/mock-ai.adapter.js';
import { GeminiAdapter } from '../modules/ai/gemini.adapter.js';
import { MenuRetrievalService } from '../modules/ai/menu-retrieval.service.js';

export interface CsvMenuItem {
  category: string;
  itemName: string;
  description: string;
  priceRupees: number;
  pricePaise: number;
  vegType: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';
  allergens: string[];
  spiceLevel: number;
  calories?: number;
  prepTimeMin?: number;
}

export interface GeneratedTableQr {
  tableNumber: string;
  tableId: string;
  capacity: number;
  section: string;
  qrVersion: number;
  token: string;
  scanUrl: string;
}

export interface PilotSeederOptions {
  orgName?: string;
  orgSlug?: string;
  outletName?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  staffPassword?: string;
  menuCsvPath?: string;
  tableCount?: number;
  appBaseUrl?: string;
}

/**
 * Pure, zero-dependency RFC 4180 compliant CSV line parser.
 * Handles quoted fields with embedded commas and spaces.
 */
export function parseCsvRows(rawCsv: string): string[][] {
  const rows: string[][] = [];
  const lines = rawCsv.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of lines) {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim());
    rows.push(fields);
  }

  return rows;
}

/**
 * Parse menu items from CSV rows with strict data validation.
 * Converts rupee prices to integer paise (AGENTS §2 rule 1).
 */
export function parseMenuCsv(rawCsv: string): CsvMenuItem[] {
  const rows = parseCsvRows(rawCsv);
  if (rows.length < 2) {
    throw new Error('Menu CSV must contain a header row and at least one item row');
  }

  const header = rows[0]!.map((h) => h.toLowerCase());
  const catIdx = header.indexOf('category');
  const nameIdx = header.indexOf('item_name');
  const descIdx = header.indexOf('description');
  const priceIdx = header.indexOf('price_rupees');
  const vegIdx = header.indexOf('veg_type');
  const allergenIdx = header.indexOf('allergens');
  const spiceIdx = header.indexOf('spice_level');
  const calIdx = header.indexOf('calories');
  const prepIdx = header.indexOf('prep_time_min');

  if (catIdx === -1 || nameIdx === -1 || priceIdx === -1) {
    throw new Error('Menu CSV header missing required columns: category, item_name, price_rupees');
  }

  const items: CsvMenuItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.length < 3 || !row[nameIdx]) continue;

    const rawRupees = parseFloat(row[priceIdx] ?? '0');
    if (isNaN(rawRupees) || rawRupees < 0) {
      throw new Error(`Invalid price on row ${r + 1}: ${row[priceIdx]}`);
    }

    // Convert rupees to integer paise minor units
    const pricePaise = Math.round(rawRupees * 100);

    const rawVeg = (row[vegIdx] || 'VEG').toUpperCase();
    const vegType: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' =
      rawVeg === 'NON_VEG' || rawVeg === 'EGG' || rawVeg === 'VEGAN' ? rawVeg : 'VEG';

    const allergens = (row[allergenIdx] || '')
      .split(',')
      .map((a) => a.trim().toUpperCase())
      .filter((a) => a.length > 0);

    const spiceLevel = Math.min(3, Math.max(0, parseInt(row[spiceIdx] || '0', 10) || 0));
    const calories = row[calIdx] ? parseInt(row[calIdx]!, 10) : undefined;
    const prepTimeMin = row[prepIdx] ? parseInt(row[prepIdx]!, 10) : undefined;

    items.push({
      category: row[catIdx]!.trim(),
      itemName: row[nameIdx]!.trim(),
      description: row[descIdx]?.trim() || '',
      priceRupees: rawRupees,
      pricePaise,
      vegType,
      allergens,
      spiceLevel,
      calories,
      prepTimeMin,
    });
  }

  return items;
}

/**
 * Generate HMAC-SHA256 signature for table QR scan token.
 * Reference: ARCH §5
 */
export function generateQrToken(secret: string, tableId: string, version: number): string {
  return crypto.createHmac('sha256', secret).update(`${tableId}:${version}`).digest('hex');
}

/**
 * Main pilot restaurant seeder tool.
 */
export async function seedPilotRestaurant(options: PilotSeederOptions = {}) {
  const config = getConfig();
  const pool = getPool();

  const orgName = options.orgName || 'Royal Spice Bistro';
  const orgSlug = options.orgSlug || 'royal-spice-bistro';
  const outletName = options.outletName || 'Indiranagar Flagship';
  const ownerEmail = options.ownerEmail || 'pilot.owner@royalspice.in';
  const ownerPassword =
    options.ownerPassword ||
    process.env['PILOT_OWNER_PASSWORD'] ||
    (process.env['NODE_ENV'] === 'production' ? '' : 'PilotLaunch2026!');
  const staffPassword =
    options.staffPassword ||
    process.env['PILOT_STAFF_PASSWORD'] ||
    (process.env['NODE_ENV'] === 'production' ? '' : 'PilotStaff2026!');
  if (!ownerPassword || !staffPassword) {
    throw new Error('PILOT_OWNER_PASSWORD and PILOT_STAFF_PASSWORD are required when seeding in production.');
  }
  const tableCount = options.tableCount ?? 20;
  const appBaseUrl = options.appBaseUrl || process.env['APP_BASE_URL'] || 'http://localhost:3003';

  console.log(`[SEED] Initializing pilot onboarding for "${orgName}" (${orgSlug})...`);

  // 1. Create or retrieve organization
  let orgId: string;
  const existingOrgRes = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = $1`,
    [orgSlug],
  );

  if (existingOrgRes.rows.length > 0) {
    orgId = existingOrgRes.rows[0]!.id;
    console.log(`[SEED] Found existing organization: ${orgId}`);
  } else {
    const insertOrgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, plan, currency, country_code, timezone)
       VALUES ($1, $2, 'starter', 'INR', 'IN', 'Asia/Kolkata')
       RETURNING id`,
      [orgName, orgSlug],
    );
    orgId = insertOrgRes.rows[0]!.id;
    console.log(`[SEED] Created organization: ${orgId}`);
  }

  // Execute tenant-scoped creation under forced RLS
  return withTenantContextRaw(orgId, async (client: PoolClient) => {
    // 2. Create or retrieve outlet
    let outletId: string;
    const existingOutletRes = await client.query<{ id: string }>(
      `SELECT id FROM outlets WHERE org_id = $1 AND name = $2`,
      [orgId, outletName],
    );

    if (existingOutletRes.rows.length > 0) {
      outletId = existingOutletRes.rows[0]!.id;
      console.log(`[SEED] Found existing outlet: ${outletId}`);
    } else {
      const insertOutletRes = await client.query<{ id: string }>(
        `INSERT INTO outlets (org_id, name, address, timezone)
         VALUES ($1, $2, '100ft Road, Indiranagar, Bengaluru, KA 560038', 'Asia/Kolkata')
         RETURNING id`,
        [orgId, outletName],
      );
      outletId = insertOutletRes.rows[0]!.id;
      console.log(`[SEED] Created outlet: ${outletId}`);
    }

    // 3. Create or retrieve Owner + Station Staff Users
    const ensureStaffAccount = async (params: {
      username: string;
      email: string;
      displayName: string;
      role: 'OWNER' | 'MANAGER' | 'CAPTAIN' | 'KITCHEN' | 'CASHIER';
      password: string;
    }) => {
      const existingStaffRes = await client.query<{ id: string }>(
        `SELECT id FROM staff_users WHERE org_id = $1 AND (email = $2 OR username = $3)`,
        [orgId, params.email, params.username],
      );

      let staffUserId: string;
      if (existingStaffRes.rows.length > 0) {
        staffUserId = existingStaffRes.rows[0]!.id;
        console.log(`[SEED] Found existing ${params.role} account: ${params.username} (${params.email})`);
      } else {
        const passwordHash = await hashPassword(params.password);
        const insertStaffRes = await client.query<{ id: string }>(
          `INSERT INTO staff_users (org_id, username, email, password_hash, display_name, email_verified, is_active)
           VALUES ($1, $2, $3, $4, $5, true, true)
           RETURNING id`,
          [orgId, params.username, params.email, passwordHash, params.displayName],
        );
        staffUserId = insertStaffRes.rows[0]!.id;
        console.log(`[SEED] Created ${params.role} account: ${params.username} (${params.email})`);
      }

      await client.query(
        `INSERT INTO staff_memberships (org_id, user_id, outlet_id, role, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (org_id, user_id, outlet_id) DO NOTHING`,
        [orgId, staffUserId, outletId, params.role],
      );
      return staffUserId;
    };

    await ensureStaffAccount({
      username: 'owner',
      email: ownerEmail,
      displayName: 'Restaurant Owner',
      role: 'OWNER',
      password: ownerPassword,
    });

    const stationAccounts = [
      { username: 'manager', email: 'pilot.manager@royalspice.in', displayName: 'Anand Joshi', role: 'MANAGER' as const },
      { username: 'captain', email: 'pilot.captain@royalspice.in', displayName: 'Rajesh Sharma', role: 'CAPTAIN' as const },
      { username: 'kitchen', email: 'pilot.kitchen@royalspice.in', displayName: 'Chef Amit Roy', role: 'KITCHEN' as const },
      { username: 'cashier', email: 'pilot.cashier@royalspice.in', displayName: 'Pooja Iyer', role: 'CASHIER' as const },
    ];
    for (const acc of stationAccounts) {
      await ensureStaffAccount({ ...acc, password: staffPassword });
    }

    // 4. Parse and import menu CSV
    const candidatePaths = [
      options.menuCsvPath,
      path.resolve(process.cwd(), 'infra/seeds/pilot-menu.csv'),
      path.resolve(process.cwd(), '../../infra/seeds/pilot-menu.csv'),
    ].filter((p): p is string => typeof p === 'string' && fs.existsSync(p));

    const csvPath = candidatePaths[0] || path.resolve(process.cwd(), 'infra/seeds/pilot-menu.csv');

    let parsedItems: CsvMenuItem[] = [];
    if (fs.existsSync(csvPath)) {
      const csvRaw = fs.readFileSync(csvPath, 'utf8');
      parsedItems = parseMenuCsv(csvRaw);
      console.log(`[SEED] Parsed ${parsedItems.length} menu items from ${csvPath}`);
    } else {
      console.warn(`[SEED] Warning: Menu CSV not found at ${csvPath}, skipping menu items.`);
    }

    // Map categories to IDs
    const categoryMap = new Map<string, string>();
    let sortOrder = 1;

    for (const item of parsedItems) {
      if (!categoryMap.has(item.category)) {
        const catRes = await client.query<{ id: string }>(
          `SELECT id FROM menu_categories WHERE org_id = $1 AND name = $2`,
          [orgId, item.category],
        );

        let categoryId: string;
        if (catRes.rows.length > 0) {
          categoryId = catRes.rows[0]!.id;
        } else {
          const insertCat = await client.query<{ id: string }>(
            `INSERT INTO menu_categories (org_id, outlet_id, name, name_i18n, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [orgId, outletId, item.category, JSON.stringify({ en: item.category }), sortOrder++],
          );
          categoryId = insertCat.rows[0]!.id;
        }
        categoryMap.set(item.category, categoryId);
      }

      const categoryId = categoryMap.get(item.category)!;

      // Insert menu item only if not already present for this org/outlet
      const existingItem = await client.query<{ id: string }>(
        `SELECT id FROM menu_items WHERE org_id = $1 AND name = $2 AND (outlet_id IS NULL OR outlet_id = $3)`,
        [orgId, item.itemName, outletId],
      );
      if (existingItem.rows.length === 0) {
        await client.query(
          `INSERT INTO menu_items (
             org_id, outlet_id, category_id, name, name_i18n, description_i18n,
             price_paise, veg_type, allergens, spice_level, calories, prep_time_min,
             is_available, is_active
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, true)`,
          [
            orgId,
            outletId,
            categoryId,
            item.itemName,
            JSON.stringify({ en: item.itemName }),
            JSON.stringify({ en: item.description }),
            item.pricePaise,
            item.vegType,
            item.allergens,
            item.spiceLevel,
            item.calories ?? null,
            item.prepTimeMin ?? null,
          ],
        );
      }
    }
    console.log(`[SEED] Imported ${categoryMap.size} categories and ${parsedItems.length} items.`);

    // 5. Generate Physical Tables & QR Tokens
    const generatedTables: GeneratedTableQr[] = [];
    for (let t = 1; t <= tableCount; t++) {
      const tableNumber = `T${t.toString().padStart(2, '0')}`;
      const section = t <= 12 ? 'Ground Floor Indoor' : 'Open Terrace Garden';
      const capacity = t <= 4 ? 2 : t <= 16 ? 4 : 6;

      const existingTableRes = await client.query<{ id: string; qr_token_version: number }>(
        `SELECT id, qr_token_version FROM tables WHERE org_id = $1 AND outlet_id = $2 AND table_number = $3`,
        [orgId, outletId, tableNumber],
      );

      let tableId: string;
      let qrVersion: number;

      if (existingTableRes.rows.length > 0) {
        tableId = existingTableRes.rows[0]!.id;
        qrVersion = existingTableRes.rows[0]!.qr_token_version;
      } else {
        const insertTableRes = await client.query<{ id: string; qr_token_version: number }>(
          `INSERT INTO tables (org_id, outlet_id, table_number, capacity, section, qr_token_version)
           VALUES ($1, $2, $3, $4, $5, 1)
           RETURNING id, qr_token_version`,
          [orgId, outletId, tableNumber, capacity, section],
        );
        tableId = insertTableRes.rows[0]!.id;
        qrVersion = insertTableRes.rows[0]!.qr_token_version;
      }

      const token = generateQrToken(config.QR_TOKEN_SECRET, tableId, qrVersion);
      const scanUrl = `${appBaseUrl}/scan?t=${tableId}&v=${qrVersion}&sig=${token}`;

      generatedTables.push({
        tableNumber,
        tableId,
        capacity,
        section,
        qrVersion,
        token,
        scanUrl,
      });
    }
    console.log(`[SEED] Generated ${generatedTables.length} tables with cryptographic QR tokens.`);

    // 6. Vector Embeddings Reindexing (for AI Assistant)
    try {
      const apiKey = process.env['GEMINI_API_KEY'];
      const provider = apiKey ? new GeminiAdapter(apiKey) : new MockAiAdapter();
      const retrievalService = new MenuRetrievalService();
      const reindexResult = await retrievalService.reindexOutlet(orgId, outletId, provider);
      console.log(`[SEED] AI Menu Assistant reindexed ${reindexResult.itemsIndexed} items.`);
    } catch (aiErr) {
      console.warn(`[SEED] AI reindexing skipped or mock-fallback: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`);
    }

    return {
      orgId,
      orgName,
      orgSlug,
      outletId,
      outletName,
      ownerEmail,
      ownerPassword,
      staffAccounts: stationAccounts.map((s) => ({ ...s, password: staffPassword })),
      categoriesCount: categoryMap.size,
      itemsCount: parsedItems.length,
      tables: generatedTables,
    };
  });
}

// Direct CLI entrypoint execution
if (process.argv[1]?.endsWith('seed-pilot-restaurant.ts') || process.argv[1]?.endsWith('seed-pilot-restaurant.js')) {
  seedPilotRestaurant()
    .then((result) => {
      console.log('\n==========================================================');
      console.log(' PILOT ONBOARDING COMPLETED SUCCESSFULLY!');
      console.log('==========================================================');
      console.log(`Organization:  ${result.orgName} (${result.orgSlug})`);
      console.log(`Outlet:        ${result.outletName}`);
      console.log(`Owner Login:   ${result.ownerEmail} / ${result.ownerPassword}`);
      for (const staff of result.staffAccounts) {
        console.log(`${staff.role.padEnd(14)} ${staff.email} / ${staff.password}`);
      }
      console.log(`Categories:    ${result.categoriesCount}`);
      console.log(`Menu Items:    ${result.itemsCount}`);
      console.log(`Active Tables: ${result.tables.length}`);
      console.log('Sample QR Scan URLs:');
      for (const t of result.tables.slice(0, 3)) {
        console.log(`  Table ${t.tableNumber} (${t.section}, Pax ${t.capacity}): ${t.scanUrl}`);
      }
      console.log('==========================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SEED] Fatal error seeding pilot restaurant:', err);
      process.exit(1);
    });
}
