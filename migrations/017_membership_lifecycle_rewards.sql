-- V1 remediation: membership lifecycle (paid months as rows), per-month credit grants,
-- free-piece reward entitlements, referral attribution, admin-managed gift enquiries.
-- Forward-only and idempotent; no existing rows are deleted.

-- 1. Membership lifecycle --------------------------------------------------------------
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS paid_through timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS expired_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
UPDATE memberships SET paid_through = renewal_at WHERE paid_through IS NULL AND renewal_at IS NOT NULL;
UPDATE memberships SET started_at = created_at WHERE started_at IS NULL AND status IN ('active', 'paused');

ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS months integer;
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS list_amount numeric(12,2);
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS referral_id uuid;
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'purchase';
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_payments_months_valid') THEN
    ALTER TABLE membership_payments ADD CONSTRAINT membership_payments_months_valid CHECK (months IS NULL OR months BETWEEN 1 AND 24) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_payments_discount_valid') THEN
    ALTER TABLE membership_payments ADD CONSTRAINT membership_payments_discount_valid CHECK (discount_amount >= 0) NOT VALID;
  END IF;
END $$;

-- One row per paid (or gifted) membership month. Credits for a month are granted when it starts.
CREATE TABLE IF NOT EXISTS membership_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  auth_user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('payment', 'gift', 'admin')),
  membership_payment_id uuid REFERENCES membership_payments(id),
  gift_membership_id uuid,
  month_index integer NOT NULL CHECK (month_index >= 1),
  streak_month integer NOT NULL CHECK (streak_month >= 1),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  credits_granted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_periods_payment_month ON membership_periods (membership_payment_id, month_index) WHERE membership_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_periods_gift_month ON membership_periods (gift_membership_id, month_index) WHERE gift_membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_membership_periods_membership ON membership_periods (membership_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_membership_periods_due ON membership_periods (starts_at) WHERE credits_granted_at IS NULL AND voided_at IS NULL;

-- Credit grants are now one ledger row per membership month (idempotency moves to the period).
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS membership_period_id uuid;
DROP INDEX IF EXISTS uq_credit_ledger_membership_payment;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_membership_period ON credit_ledger (membership_period_id) WHERE membership_period_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_payment_legacy ON credit_ledger (membership_payment_id) WHERE membership_payment_id IS NOT NULL AND membership_period_id IS NULL;

-- 2. Free-piece reward entitlements ----------------------------------------------------
CREATE TABLE IF NOT EXISTS reward_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('six_month_milestone', 'referral')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'redeemed', 'void')),
  membership_id uuid REFERENCES memberships(id),
  membership_period_id uuid REFERENCES membership_periods(id),
  milestone_number integer CHECK (milestone_number IS NULL OR milestone_number >= 1),
  referral_id uuid,
  sequence_no integer NOT NULL DEFAULT 1 CHECK (sequence_no >= 1),
  source_payment_id uuid REFERENCES membership_payments(id),
  order_id uuid REFERENCES orders(id),
  reserved_at timestamptz,
  redeemed_at timestamptz,
  flag_reason text,
  flagged_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  voided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One six-month reward per qualifying month (month 6 of a paid 6-month plan, or — if the owner
-- chooses that rule — each 6th consecutive paid month), so duplicate events cannot issue it twice.
-- A referral issues sequence_no 1..referrer_reward_quantity, each at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_milestone_period ON reward_entitlements (membership_period_id) WHERE kind = 'six_month_milestone';
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_referral ON reward_entitlements (referral_id, sequence_no) WHERE kind = 'referral';
CREATE INDEX IF NOT EXISTS idx_reward_user ON reward_entitlements (auth_user_id, status);

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS reward_entitlement_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_reward ON cart_items (reward_entitlement_id) WHERE reward_entitlement_id IS NOT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS reward_entitlement_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_reward ON order_items (reward_entitlement_id) WHERE reward_entitlement_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rewards_used integer NOT NULL DEFAULT 0;

-- Explicit credit/reward eligibility instead of matching the badge text (Premium pieces stay excluded).
ALTER TABLE products ADD COLUMN IF NOT EXISTS credit_eligible boolean NOT NULL DEFAULT true;
UPDATE products SET credit_eligible = false WHERE credit_eligible AND lower(coalesce(badge, '')) LIKE '%premium%';

-- 3. Colour profile category ------------------------------------------------------------
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS season text;

-- 4. Referrals ---------------------------------------------------------------------------
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS referral_code text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_profiles_referral_code ON customer_profiles (referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_user_id text;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS attributed_at timestamptz;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at timestamptz;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_payment_id uuid;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred_user ON referrals (referred_user_id) WHERE referred_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_user_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_status_valid') THEN
    ALTER TABLE referrals ADD CONSTRAINT referrals_status_valid CHECK (status IN ('shared', 'attributed', 'qualified', 'refunded', 'void')) NOT VALID;
  END IF;
END $$;

-- 5. Admin-managed gift enquiries and gift memberships ----------------------------------
CREATE SEQUENCE IF NOT EXISTS gift_enquiry_number_seq START 1001;
CREATE TABLE IF NOT EXISTS admin_gift_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_number text NOT NULL UNIQUE DEFAULT ('GE-' || nextval('gift_enquiry_number_seq')),
  submitted_by text,
  request_type text NOT NULL DEFAULT 'individual' CHECK (request_type IN ('individual', 'corporate')),
  sender_name text NOT NULL,
  sender_email text NOT NULL,
  sender_phone text NOT NULL,
  company_name text,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  membership_months integer NOT NULL CHECK (membership_months BETWEEN 1 AND 24),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'invoiced')),
  admin_notes text,
  invoice_reference text,
  invoice_amount numeric(12,2) CHECK (invoice_amount IS NULL OR invoice_amount >= 0),
  status_changed_by text,
  status_changed_at timestamptz,
  processed_at timestamptz,
  invoiced_at timestamptz,
  submission_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_enquiries_submission ON admin_gift_enquiries (submission_key) WHERE submission_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gift_enquiries_status ON admin_gift_enquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_enquiries_sender ON admin_gift_enquiries (lower(sender_email), created_at DESC);

CREATE TABLE IF NOT EXISTS gift_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES admin_gift_enquiries(id),
  membership_months integer NOT NULL CHECK (membership_months BETWEEN 1 AND 24),
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_by text,
  redeemed_at timestamptz,
  membership_id uuid REFERENCES memberships(id),
  revoked_by text,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gift_memberships_enquiry ON gift_memberships (enquiry_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_periods_gift_fk') THEN
    ALTER TABLE membership_periods ADD CONSTRAINT membership_periods_gift_fk FOREIGN KEY (gift_membership_id) REFERENCES gift_memberships(id);
  END IF;
END $$;

-- 6. New settings (owner-editable in Admin → Settings; confirmed vs proposed defaults are listed
-- in lib/settings.js and docs/VISHREA_AUDIT_REMEDIATION_REPORT.md §16). Free-piece eligibility starts
-- empty: no product is eligible until the owner chooses. Legal details start empty and unverified.
INSERT INTO app_settings (key, value) VALUES
  ('membership_plan_months', '[2, 6]'::jsonb),
  ('renewal_window_days', '0'::jsonb),
  ('six_month_reward_enabled', 'true'::jsonb),
  ('six_month_reward_qualification', '"six_month_plan"'::jsonb),
  ('reward_eligible_category_ids', '[]'::jsonb),
  ('reward_eligible_product_ids', '[]'::jsonb),
  ('reward_max_price_inr', '0'::jsonb),
  ('referral_discount_inr', '150'::jsonb),
  ('referral_plan_months', '2'::jsonb),
  ('referrer_reward_quantity', '1'::jsonb),
  ('gift_enquiry_types', '["individual", "corporate"]'::jsonb),
  ('gift_membership_months', '[2, 6]'::jsonb),
  ('gift_token_valid_days', '90'::jsonb),
  ('seller_legal_name', '""'::jsonb),
  ('seller_address', '""'::jsonb),
  ('grievance_officer_name', '""'::jsonb),
  ('grievance_officer_email', '""'::jsonb),
  ('grievance_officer_phone', '""'::jsonb),
  ('legal_details_verified', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
