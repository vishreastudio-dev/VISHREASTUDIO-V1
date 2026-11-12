-- Migration 025: Vishrea AI Studio & Style Assistant tables
-- Additive and idempotent schema additions

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('admin', 'customer')),
  auth_user_id TEXT,
  session_id TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  input_context JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES ai_content_drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_session ON ai_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_role ON ai_conversations(role);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_admin ON ai_content_drafts(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_product ON ai_content_drafts(product_id);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_status ON ai_content_drafts(status);
CREATE INDEX IF NOT EXISTS idx_ai_versions_draft ON ai_content_versions(draft_id, version);

