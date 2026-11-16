-- ============================================================================
-- 0026 — Apply Scale & Performance Indexes (Phase 2 Database Scalability Audit)
--
-- Purpose:
--   1. Orders feed covering indexes: accelerates live KDS feed, manager orders,
--      and customer order queries with index-only scans and eliminates top-N sorts.
--   2. Order items foreign key & covering indexes: prevents full table scans on
--      menu_items updates/deletes (FK validation) and accelerates attachItemsToOrders.
--   3. Payments covering index: accelerates correlated payment subqueries in
--      getMyOrders / getOrdersBySession and bounded reconciliation scans.
--   4. Outbox events global FIFO partial index: replaces org-scoped index with a
--      global FIFO index for fetch_and_claim_outbox_events (FOR UPDATE SKIP LOCKED).
--   5. Item availability covering index: turns scheduled availability checks
--      during placeOrder into an index-only scan.
--
-- Reference: ARCH §25 (Database Scalability), AGENTS §2 rule 6 & rule 14
-- ============================================================================

-- 1. Orders Feed Covering Indexes
CREATE INDEX IF NOT EXISTS orders_feed_outlet_created_idx
  ON orders (org_id, outlet_id, created_at DESC)
  INCLUDE (status, total_paise, table_id, session_id);

CREATE INDEX IF NOT EXISTS orders_feed_status_created_idx
  ON orders (org_id, outlet_id, status, created_at DESC);

-- 2. Order Items Foreign Key & Lookup Covering Indexes
CREATE INDEX IF NOT EXISTS order_items_menu_item_fk_idx
  ON order_items (org_id, menu_item_id);

CREATE INDEX IF NOT EXISTS order_items_order_lookup_covering_idx
  ON order_items (org_id, order_id, created_at ASC)
  INCLUDE (menu_item_id, name_snapshot, unit_price_paise, quantity, line_total_paise, status, target_table_id);

-- 3. Payments Covering & Reconciliation Indexes
CREATE INDEX IF NOT EXISTS payments_order_feed_covering_idx
  ON payments (order_id, created_at DESC)
  INCLUDE (status, method, settled_at);

CREATE INDEX IF NOT EXISTS payments_reconciliation_pending_idx
  ON payments (created_at ASC)
  WHERE status IN ('CREATED', 'PENDING') AND provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_org_status_created_idx
  ON payments (org_id, status, created_at DESC);

-- 4. Outbox Events Global FIFO Partial Index
CREATE INDEX IF NOT EXISTS outbox_events_global_fifo_idx
  ON outbox_events (created_at ASC)
  WHERE delivered_at IS NULL;

-- 5. Item Availability Covering Index
CREATE INDEX IF NOT EXISTS item_availability_covering_idx
  ON item_availability (org_id, item_id, outlet_id)
  INCLUDE (day_of_week, start_time, end_time, is_available);
