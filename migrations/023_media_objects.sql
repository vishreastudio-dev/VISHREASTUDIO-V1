-- Migration 023: metadata for every stored media file (Supabase Storage or the local development store).
-- Additive only. Files live in object storage; this table records where each one is, what it is
-- (type, size, pixel size, video length, SHA-256) and who it belongs to, so the application never
-- has to read a file back to validate it, and cleanup can tell referenced files from orphans.
-- Existing `/uploads/...` references keep working until they are migrated (scripts/media-migrate.js).

CREATE TABLE IF NOT EXISTS media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver text NOT NULL CHECK (driver IN ('supabase', 'local')),
  bucket text NOT NULL CHECK (bucket ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  object_path text NOT NULL CHECK (length(object_path) <= 400 AND object_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$' AND object_path !~ '\.\.'),
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  purpose text NOT NULL CHECK (purpose IN ('product', 'banner', 'instagram', 'video', 'evidence', 'archive')),
  -- What the database stores to point at this file: a public URL, or storage://bucket/path when private.
  ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  mime text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_seconds numeric(8,2),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  owner_id text,
  uploaded_by text,
  -- Set for files copied from the old local store, so their original `/uploads/...` URL is traceable.
  legacy_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_objects_bucket_path UNIQUE (driver, bucket, object_path)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_objects_ref ON media_objects (ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_objects_dedupe ON media_objects (sha256, purpose, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_objects_legacy ON media_objects (legacy_url) WHERE legacy_url IS NOT NULL;

-- Same hosted-Postgres lockdown as the other application tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE media_objects ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON media_objects FROM anon, authenticated;
  END IF;
END $$;
