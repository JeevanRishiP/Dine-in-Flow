-- ============================================================
-- 0012 — AI Menu Assistant Sessions, Redacted Transcripts, and Q&A Cache
-- Tables:
--   1. ai_sessions (session-scoped AI chats, message/token budgets)
--   2. ai_chat_transcripts (append-only redacted conversation logs, no PII)
--   3. ai_qa_cache (frequent Q&A caching per outlet)
--
-- Invariants (AGENTS §2, ARCH §21):
--   - All tables enforce org_id + forced RLS (Rule 3).
--   - Transcripts are append-only: INSERT, SELECT only (Rule 6).
--   - No customer PII stored in transcripts (Rule 7).
-- ============================================================

-- ============================================================
-- 1. AI Sessions (Rate limiting & Token Budget tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id         uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  table_session_id  uuid        REFERENCES table_sessions (id) ON DELETE SET NULL,
  customer_id       uuid        REFERENCES customers (id) ON DELETE SET NULL,
  message_count     int         NOT NULL DEFAULT 0,
  tokens_used       int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_sessions_org_outlet_idx ON ai_sessions (org_id, outlet_id);
CREATE INDEX IF NOT EXISTS ai_sessions_table_session_idx ON ai_sessions (table_session_id);

ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_sessions
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON ai_sessions TO dineflow_app;

-- ============================================================
-- 2. AI Chat Transcripts (Redacted, No PII, Append-Only)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chat_transcripts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id        uuid        NOT NULL REFERENCES ai_sessions (id) ON DELETE CASCADE,
  role              text        NOT NULL CHECK (role IN ('user', 'model', 'system')),
  content_redacted  text        NOT NULL,
  tool_calls        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_transcripts_session_idx ON ai_chat_transcripts (org_id, session_id, created_at ASC);

ALTER TABLE ai_chat_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_transcripts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_chat_transcripts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Append-only: SELECT, INSERT only (AGENTS §2 rule 6)
GRANT SELECT, INSERT ON ai_chat_transcripts TO dineflow_app;

-- ============================================================
-- 3. AI Q&A Cache (Caching frequent questions per outlet)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_qa_cache (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id         uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  question_hash     text        NOT NULL,
  question_clean    text        NOT NULL,
  answer            text        NOT NULL,
  tool_proposals    jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,

  CONSTRAINT uq_ai_qa_cache UNIQUE (org_id, outlet_id, question_hash)
);

CREATE INDEX IF NOT EXISTS ai_qa_cache_lookup_idx ON ai_qa_cache (org_id, outlet_id, question_hash);
CREATE INDEX IF NOT EXISTS ai_qa_cache_expiry_idx ON ai_qa_cache (expires_at);

ALTER TABLE ai_qa_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_qa_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_qa_cache
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_qa_cache TO dineflow_app;
