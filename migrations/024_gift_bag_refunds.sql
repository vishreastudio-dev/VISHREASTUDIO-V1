-- Migration 024: refunds of online gift purchases and Wardrobe Bag shipping fees.
-- Additive only. Each Razorpay refund is recorded once (by refund id) so a redelivered or repeated
-- refund.processed event never counts twice; the parent row keeps the running total and a status:
-- NULL (no refund), 'partial', or 'refunded' (the whole paid amount).

CREATE TABLE IF NOT EXISTS payment_refunds (
  razorpay_refund_id text PRIMARY KEY,
  provider_payment_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('gift_enquiry', 'bag_shipment')),
  entity_id uuid NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_entity ON payment_refunds (entity_type, entity_id);

ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS refunded_amount_paise integer NOT NULL DEFAULT 0;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS refund_status text;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE bag_shipments ADD COLUMN IF NOT EXISTS refunded_amount_paise integer NOT NULL DEFAULT 0;
ALTER TABLE bag_shipments ADD COLUMN IF NOT EXISTS refund_status text;
ALTER TABLE bag_shipments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_gift_enquiries_refund_status_valid') THEN
    ALTER TABLE admin_gift_enquiries ADD CONSTRAINT admin_gift_enquiries_refund_status_valid CHECK (refund_status IS NULL OR refund_status IN ('partial', 'refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bag_shipments_refund_status_valid') THEN
    ALTER TABLE bag_shipments ADD CONSTRAINT bag_shipments_refund_status_valid CHECK (refund_status IS NULL OR refund_status IN ('partial', 'refunded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gift_enquiries_payment ON admin_gift_enquiries (provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- Same hosted-Postgres lockdown as the other application tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON payment_refunds FROM anon, authenticated;
  END IF;
END $$;
