-- Migration 0025: Dish Reviews table for diner food item reviews (ARCH §19, AGENTS §2 Rule 3)
-- Reference: ARCH §19, PROMPTS Phase 8, AGENTS §2 Rule 3 & Rule 6

CREATE TABLE IF NOT EXISTS dish_reviews (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id      uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  order_id       uuid        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id   uuid        NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  customer_id    uuid        REFERENCES customers (id) ON DELETE SET NULL,
  dish_name      text        NOT NULL,
  rating         smallint    NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_dish_review_order_item UNIQUE (org_id, order_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS dish_reviews_org_idx ON dish_reviews (org_id);
CREATE INDEX IF NOT EXISTS dish_reviews_customer_idx ON dish_reviews (org_id, customer_id);
CREATE INDEX IF NOT EXISTS dish_reviews_menu_item_idx ON dish_reviews (org_id, menu_item_id);
CREATE INDEX IF NOT EXISTS dish_reviews_order_idx ON dish_reviews (org_id, order_id);

ALTER TABLE dish_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dish_reviews
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON dish_reviews TO dineflow_app;
