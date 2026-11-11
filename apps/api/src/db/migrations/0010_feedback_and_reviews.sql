-- ============================================================
-- 0010 — Feedback, Google Business Profile Connections, Review Snapshots
-- Tables:
--   1. feedback (private guest feedback on orders, rating 1-5, tags, comments)
--   2. gbp_connections (Google Business Profile OAuth connection with encrypted token)
--   3. review_snapshots (synced Google reviews, NO linkage to customers or orders)
--
-- Invariants (AGENTS §2, ARCH §19):
--   - All tables enforce org_id + forced RLS (Rule 3).
--   - Exactly one feedback per order: UNIQUE (org_id, order_id).
--   - Review snapshots MUST NOT link to customer_id or order_id (AGENTS §2 rule 10).
--   - Reference: ARCH §19, §7, PROMPTS Phase 8
-- ============================================================

-- ============================================================
-- 1. Feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id              uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  order_id               uuid        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  customer_id            uuid        REFERENCES customers (id) ON DELETE SET NULL,
  rating                 smallint    NOT NULL CHECK (rating >= 1 AND rating <= 5),
  tags                   text[]      NOT NULL DEFAULT '{}',
  comment                text,
  points_rewarded_paise  bigint      NOT NULL DEFAULT 0 CHECK (points_rewarded_paise >= 0),
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- One feedback per order
  CONSTRAINT uq_feedback_order UNIQUE (org_id, order_id)
);

CREATE INDEX IF NOT EXISTS feedback_org_idx ON feedback (org_id);
CREATE INDEX IF NOT EXISTS feedback_outlet_rating_idx ON feedback (org_id, outlet_id, rating);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (org_id, created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT ON feedback TO dineflow_app;

-- ============================================================
-- 2. Google Business Profile Connections
-- ============================================================
CREATE TABLE IF NOT EXISTS gbp_connections (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id          uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  google_account_ref text        NOT NULL,
  location_ref       text        NOT NULL,
  refresh_token_enc  text        NOT NULL, -- Encrypted using AES-256-GCM
  status             text        NOT NULL DEFAULT 'CONNECTED'
                       CHECK (status IN ('CONNECTED', 'DISCONNECTED', 'EXPIRED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_gbp_outlet UNIQUE (org_id, outlet_id)
);

CREATE INDEX IF NOT EXISTS gbp_connections_org_idx ON gbp_connections (org_id);

ALTER TABLE gbp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gbp_connections
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON gbp_connections TO dineflow_app;

-- ============================================================
-- 3. Review Snapshots (NO linkage to customers/orders)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_snapshots (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id             uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  review_ref            text        NOT NULL, -- Google review resource ID
  star_rating           smallint    NOT NULL CHECK (star_rating >= 1 AND star_rating <= 5),
  comment               text,
  reviewer_display_name text,
  create_time           timestamptz NOT NULL,
  update_time           timestamptz,
  reply_text            text,
  replied_at            timestamptz,
  replied_by            uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_review_ref UNIQUE (org_id, review_ref)
);

CREATE INDEX IF NOT EXISTS review_snapshots_org_outlet_idx ON review_snapshots (org_id, outlet_id, star_rating);
CREATE INDEX IF NOT EXISTS review_snapshots_create_time_idx ON review_snapshots (org_id, create_time DESC);

ALTER TABLE review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON review_snapshots
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON review_snapshots TO dineflow_app;
