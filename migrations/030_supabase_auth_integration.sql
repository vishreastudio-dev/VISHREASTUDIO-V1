-- Migration 030: Supabase Authentication Integration
-- Maps Supabase Auth identities (UUID) to existing application customer and admin profiles.
-- Safe, non-destructive migration preserving existing internal IDs and all historical relationships.

-- 1. Add supabase_user_id column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS supabase_user_id text;

-- 2. Add sparse unique index on supabase_user_id so each Supabase Auth identity maps to exactly one profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_supabase_user_id ON profiles (supabase_user_id) WHERE supabase_user_id IS NOT NULL;

-- 3. Add index on lower(email) for fast, case-insensitive account linking
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles (lower(email));
