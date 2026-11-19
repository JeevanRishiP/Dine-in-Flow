/**
 * Database Reset Script: Clean Transactional Data & Preserve Core
 *
 * Deletes/truncates all transactional, dummy, test data:
 * - Orders, Order Items, Events, Counters
 * - Payments, Refunds, Invoices, Counters, Flags, Webhooks
 * - Tables, Sessions, Reservations, Temp Customers
 * - Coupons & Redemptions
 * - Feedback & Reviews (GBP, Dish Reviews)
 * - Customer Accounts, Diner Profiles, Consents, OTPs
 * - AI Sessions & Transcripts
 * - Analytics Rollups & Exports
 * - Loyalty Ledger & Referrals
 * - Outbox, Audit Logs, Message Logs
 *
 * STRICTLY PRESERVES:
 * 1. Active Organizations & Outlets
 * 2. Menu Categories & Menu Items
 * 3. Login credentials for Owner and 4 core staff (Kitchen, Captain, Waiter, Cashier)
 *
 * Reference: ARCH §6, §7, §12; AGENTS §2
 */

import { Pool } from 'pg';
import { hashPassword } from '../modules/auth/crypto.js';

const connectionString =
  process.env['DATABASE_MIGRATOR_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:postgres@localhost:5433/dineflow_dev';

export async function resetKeepCore() {
  const pool = new Pool({ connectionString });
  console.log('[RESET] Connecting to database...');

  try {
    // 1. Truncate all transactional tables in one atomic statement
    console.log('[RESET] Truncating transactional & test tables...');
    await pool.query(`
      TRUNCATE TABLE
        orders,
        order_items,
        order_events,
        order_counters,
        payments,
        refunds,
        invoices,
        invoice_counters,
        payment_reconciliation_flags,
        webhook_inbox,
        table_sessions,
        table_reservations,
        table_reservation_slots,
        temp_customer_tables,
        temp_customers,
        tables,
        coupon_redemptions,
        coupons,
        feedback,
        review_snapshots,
        gbp_connections,
        dish_reviews,
        customer_otp_codes,
        customer_refresh_tokens,
        diner_profiles,
        consents,
        privacy_requests,
        customers,
        ai_sessions,
        ai_chat_transcripts,
        ai_qa_cache,
        analytics_daily_outlet_rollups,
        analytics_hourly_outlet_rollups,
        analytics_item_daily_rollups,
        analytics_payment_daily_rollups,
        analytics_exports,
        loyalty_ledger,
        referrals,
        message_log,
        outbox_events,
        audit_logs,
        staff_refresh_tokens
      CASCADE;
    `);
    console.log('[RESET] ✓ Transactional tables truncated successfully.');

    // 2. Ensure core staff users for Royal Spice Bistro (Owner + Kitchen, Captain, Waiter, Cashier)
    const orgRes = await pool.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = 'royal-spice-bistro' LIMIT 1`,
    );
    if (orgRes.rows[0]) {
      const orgId = orgRes.rows[0].id;
      const outletRes = await pool.query<{ id: string }>(
        `SELECT id FROM outlets WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );
      const outletId = outletRes.rows[0]?.id || null;

      const passwordHash = await hashPassword('1234');
      const coreStaff = [
        { username: 'owner', email: 'pilot.owner@royalspice.in', name: 'Restaurant Owner', role: 'OWNER' },
        { username: 'kitchen', email: 'pilot.kitchen@royalspice.in', name: 'Chef Amit Roy', role: 'KITCHEN' },
        { username: 'captain', email: 'pilot.captain@royalspice.in', name: 'Rajesh Sharma', role: 'CAPTAIN' },
        { username: 'waiter', email: 'pilot.waiter@royalspice.in', name: 'Suresh Kumar', role: 'WAITER' },
        { username: 'cashier', email: 'pilot.cashier@royalspice.in', name: 'Pooja Iyer', role: 'CASHIER' },
      ];

      for (const s of coreStaff) {
        // Upsert staff user
        const existing = await pool.query<{ id: string }>(
          `SELECT id FROM staff_users WHERE org_id = $1 AND (email = $2 OR username = $3)`,
          [orgId, s.email, s.username],
        );
        let staffId: string;
        if (existing.rows[0]) {
          staffId = existing.rows[0].id;
          await pool.query(
            `UPDATE staff_users SET username = $1, display_name = $2, is_active = true WHERE id = $3`,
            [s.username, s.name, staffId],
          );
        } else {
          const inserted = await pool.query<{ id: string }>(
            `INSERT INTO staff_users (org_id, username, email, password_hash, display_name, email_verified, is_active)
             VALUES ($1, $2, $3, $4, $5, true, true)
             RETURNING id`,
            [orgId, s.username, s.email, passwordHash, s.name],
          );
          staffId = inserted.rows[0]!.id;
        }

        // Upsert membership
        await pool.query(
          `INSERT INTO staff_memberships (org_id, user_id, outlet_id, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (org_id, user_id, outlet_id) DO UPDATE SET role = EXCLUDED.role, is_active = true`,
          [orgId, staffId, s.role === 'OWNER' ? null : outletId, s.role],
        );
      }
      console.log('[RESET] ✓ Preserved and verified core staff logins (Owner, Kitchen, Captain, Waiter, Cashier).');
    }

    // 3. Query all remaining menu items
    const menuRes = await pool.query<{
      id: string;
      category_name: string;
      name: string;
      dietary_type: string;
      price_paise: number;
    }>(`
      SELECT
        mi.id,
        mc.name AS category_name,
        mi.name,
        mi.veg_type AS dietary_type,
        mi.price_paise
      FROM menu_items mi
      JOIN menu_categories mc ON mc.id = mi.category_id
      ORDER BY mc.sort_order, mi.sort_order, mi.name;
    `);

    console.log(`\n================================================================================`);
    console.log(` REMAINING MENU ITEMS IN POSTGRESQL (Total: ${menuRes.rows.length})`);
    console.log(`================================================================================`);
    console.table(
      menuRes.rows.map((r) => ({
        id: r.id,
        category: r.category_name,
        name: r.name,
        dietary: r.dietary_type,
        price: `₹${(r.price_paise / 100).toFixed(2)}`,
      })),
    );

    return menuRes.rows;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('reset-keep-core.ts') || process.argv[1]?.endsWith('reset-keep-core.js')) {
  resetKeepCore()
    .then(() => {
      console.log('\n[RESET] Database reset completed successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[RESET] Fatal error resetting database:', err);
      process.exit(1);
    });
}
