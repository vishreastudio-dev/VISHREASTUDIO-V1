-- Walkin Wardrobe billing engine (MEM-01..MEM-16):
-- * 2 months paid upfront in the same checkout that authorises a UPI Autopay mandate (Razorpay
--   Subscription with a future start and an upfront add-on), then ₹1,799 a month from month 3;
-- * membership, billing (mandate) and credit state are tracked separately; every gateway attempt
--   and every lifecycle change is kept as history;
-- * Wardrobe Bag shipments, online gift purchases and a notification log.
-- Forward-only and idempotent; existing rows are kept.

-- 1. Membership billing state ------------------------------------------------------------
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'none';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS mandate_status text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS next_charge_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS lock_in_until timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS retry_started_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS pause_starts_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS pause_ends_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancel_reason text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_billing_status_valid') THEN
    ALTER TABLE memberships ADD CONSTRAINT memberships_billing_status_valid CHECK (billing_status IN
      ('none', 'prepaid', 'pending_authorisation', 'active', 'retrying', 'halted', 'cancelled', 'completed')) NOT VALID;
  END IF;
END $$;
-- Prepaid memberships bought before autopay keep working until their paid period ends.
UPDATE memberships SET billing_status = 'prepaid'
 WHERE billing_status = 'none' AND autopay_subscription_id IS NULL AND paid_through IS NOT NULL;

-- One Razorpay plan per monthly amount (plans are immutable at the gateway).
CREATE TABLE IF NOT EXISTS billing_plans (
  amount_paise integer PRIMARY KEY CHECK (amount_paise > 0),
  razorpay_plan_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every mandate the customer was asked to authorise. One unanswered request at a time per membership;
-- an older mandate is superseded (and cancelled at the gateway) only once a new one is paid for.
CREATE TABLE IF NOT EXISTS membership_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  auth_user_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup', 'recovery')),
  razorpay_subscription_id text UNIQUE,
  razorpay_plan_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN
    ('created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired', 'superseded')),
  monthly_amount numeric(12,2) NOT NULL CHECK (monthly_amount > 0),
  upfront_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (upfront_amount >= 0),
  upfront_months integer NOT NULL DEFAULT 0 CHECK (upfront_months >= 0),
  list_amount numeric(12,2),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  referral_id uuid,
  start_at timestamptz,
  short_url text,
  authenticated_at timestamptz,
  activated_at timestamptz,
  halted_at timestamptz,
  cancelled_at timestamptz,
  cancel_initiated_by text,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_subscriptions_open_request ON membership_subscriptions (membership_id) WHERE status = 'created';
CREATE INDEX IF NOT EXISTS idx_membership_subscriptions_user ON membership_subscriptions (auth_user_id, created_at DESC);

ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS subscription_ref uuid REFERENCES membership_subscriptions(id);
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS razorpay_invoice_id text;
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS charge_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_payments_invoice ON membership_payments (razorpay_invoice_id) WHERE razorpay_invoice_id IS NOT NULL;
-- One upfront charge per mandate, so a duplicate webhook and the browser cannot both apply it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_payments_upfront ON membership_payments (subscription_ref) WHERE charge_kind = 'upfront';

-- Every gateway charge attempt, successful or not (failures and retries included).
CREATE TABLE IF NOT EXISTS membership_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  auth_user_id text NOT NULL,
  razorpay_subscription_id text,
  provider_payment_id text,
  razorpay_invoice_id text,
  amount numeric(12,2),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'retrying', 'halted')),
  attempt_no integer,
  failure_reason text,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_payment_attempts_event ON membership_payment_attempts (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_membership_payment_attempts_membership ON membership_payment_attempts (membership_id, created_at DESC);

-- Membership lifecycle history: activation, pauses, resumptions, retries, cancellations.
CREATE TABLE IF NOT EXISTS membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  auth_user_id text NOT NULL,
  event text NOT NULL,
  actor text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_membership_events_membership ON membership_events (membership_id, created_at DESC);

-- 2. Wardrobe Bag (MEM-06) ------------------------------------------------------------------
-- A credit pick is sold at once and waits as an order in status 'in_bag' until "Ship my bag".
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_valid;
ALTER TABLE orders ADD CONSTRAINT orders_status_valid CHECK (status IN
  ('pending_payment','in_bag','processing','packed','dispatched','delivered','cancelled','expired','refund_required','refunded')) NOT VALID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bag_shipment_id uuid;
CREATE INDEX IF NOT EXISTS idx_orders_in_bag ON orders (auth_user_id) WHERE status = 'in_bag';

CREATE TABLE IF NOT EXISTS bag_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'expired')),
  shipping_method text NOT NULL CHECK (shipping_method IN ('delivery', 'pickup')),
  shipping_address jsonb NOT NULL,
  order_ids uuid[] NOT NULL,
  pieces integer NOT NULL CHECK (pieces > 0),
  shipping_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  amount_paise integer NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  razorpay_order_id text UNIQUE,
  provider_payment_id text UNIQUE,
  payment_expires_at timestamptz,
  paid_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bag_shipments_idem ON bag_shipments (auth_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bag_shipments_open ON bag_shipments (auth_user_id) WHERE status = 'pending_payment';

-- 3. Early access (MEM-02, CAT-09): products scheduled into a drop -------------------------
CREATE INDEX IF NOT EXISTS idx_products_drop ON products (drop_id) WHERE drop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drop_settings_window ON drop_settings (starts_at, public_at) WHERE active;

-- 4. Online gift memberships (MEM-12..15) ----------------------------------------------------
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'enquiry';
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS gift_mode text;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS wearer_id uuid;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS provider_payment_id text;
ALTER TABLE admin_gift_enquiries ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_enquiries_rzp_order ON admin_gift_enquiries (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_enquiries_payment ON admin_gift_enquiries (provider_payment_id) WHERE provider_payment_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_enquiries_mode_valid') THEN
    ALTER TABLE admin_gift_enquiries ADD CONSTRAINT gift_enquiries_mode_valid CHECK (gift_mode IS NULL OR gift_mode IN ('gift_to_her', 'pick_for_her')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_enquiries_source_valid') THEN
    ALTER TABLE admin_gift_enquiries ADD CONSTRAINT gift_enquiries_source_valid CHECK (source IN ('enquiry', 'online')) NOT VALID;
  END IF;
END $$;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS gift_wearer_id uuid;

-- 5. Notification log (central notification service) ---------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text,
  event text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms', 'log')),
  category text NOT NULL DEFAULT 'transactional' CHECK (category IN ('transactional', 'marketing')),
  recipient text,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  reason text,
  dedupe_key text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications (dedupe_key, channel) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (auth_user_id, created_at DESC);

-- 6. Settings --------------------------------------------------------------------------------
-- The 2-month upfront + monthly autopay plan replaces prepaid durations for new members.
UPDATE app_settings SET value = '[2]'::jsonb WHERE key = 'membership_plan_months';
UPDATE app_settings SET value = '2'::jsonb WHERE key = 'membership_upfront_months';
INSERT INTO app_settings (key, value) VALUES
  ('membership_lock_in_months', '2'::jsonb),
  ('credit_holding_limit', '8'::jsonb),
  ('pause_length_months', '1'::jsonb),
  ('autopay_retry_count', '3'::jsonb),
  ('autopay_retry_days', '5'::jsonb),
  ('subscription_total_count', '120'::jsonb)
ON CONFLICT (key) DO NOTHING;
UPDATE app_settings SET value = '[2, 3, 6, 12]'::jsonb WHERE key = 'gift_membership_months' AND value = '[2, 6]'::jsonb;
