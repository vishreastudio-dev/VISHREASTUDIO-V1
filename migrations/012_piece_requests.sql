-- Migration 012: Piece Requests ("Request a Piece" Feature)
-- Allows customers to request unavailable, one-of-one, or custom pieces
-- Human-readable request numbers: VR-YYYY-00001
-- Statuses: NEW, REVIEWING, CONTACTED, SOURCING, AVAILABLE, RESERVED, CONVERTED, CLOSED, NOT_AVAILABLE, CUSTOMER_NOT_RESPONDED, CANCELLED

-- Sequence for human-readable request numbers per year
CREATE SEQUENCE IF NOT EXISTS piece_requests_seq START 1;

CREATE TABLE IF NOT EXISTS piece_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL,
  customer_id text,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  preferred_contact_method text NOT NULL DEFAULT 'WhatsApp' CHECK (preferred_contact_method IN ('Phone', 'Email', 'WhatsApp')),
  category text,
  preferred_size text,
  preferred_colour text,
  description text NOT NULL,
  source_product_id text,
  source_product_name text,
  source_product_url text,
  reference_url text,
  attachment_url text,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW',
    'REVIEWING',
    'CONTACTED',
    'SOURCING',
    'AVAILABLE',
    'RESERVED',
    'CONVERTED',
    'CLOSED',
    'NOT_AVAILABLE',
    'CUSTOMER_NOT_RESPONDED',
    'CANCELLED'
  )),
  admin_notes text DEFAULT '',
  assigned_admin text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  contacted_at timestamptz,
  closed_at timestamptz
);

-- Trigger / function for auto-generating human-readable request numbers: VR-YYYY-00001
CREATE OR REPLACE FUNCTION generate_piece_request_number()
RETURNS trigger AS $$
DECLARE
  current_yr text;
  seq_num bigint;
BEGIN
  current_yr := to_char(CURRENT_DATE, 'YYYY');
  seq_num := nextval('piece_requests_seq');
  NEW.request_number := 'VR-' || current_yr || '-' || lpad(seq_num::text, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_piece_request_number ON piece_requests;
CREATE TRIGGER trg_piece_request_number
BEFORE INSERT ON piece_requests
FOR EACH ROW
WHEN (NEW.request_number IS NULL OR NEW.request_number = '')
EXECUTE FUNCTION generate_piece_request_number();

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_piece_requests_customer_id ON piece_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_piece_requests_status ON piece_requests(status);
CREATE INDEX IF NOT EXISTS idx_piece_requests_created_at ON piece_requests(created_at DESC);

-- Access control is enforced by the Express API (the only database client).
-- RLS is enabled so that a hosted PostgREST endpoint (e.g. Supabase anon key) cannot read or
-- write customer data; no anon policies are granted. See 013_production_hardening.sql.
ALTER TABLE piece_requests ENABLE ROW LEVEL SECURITY;

-- The original Supabase-only policies referenced auth.uid(), which does not exist on plain
-- PostgreSQL. Drop them wherever they were created.
DROP POLICY IF EXISTS customer_insert_piece_requests ON piece_requests;
DROP POLICY IF EXISTS customer_select_own_piece_requests ON piece_requests;
DROP POLICY IF EXISTS admin_select_all_piece_requests ON piece_requests;
DROP POLICY IF EXISTS admin_update_all_piece_requests ON piece_requests;
