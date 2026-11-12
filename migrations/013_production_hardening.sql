-- Production hardening: variants & variant pricing, database-authoritative inventory
-- reservations, payment/webhook idempotency, OTP storage, GST invoice data, integrity
-- constraints and query-pattern indexes. Every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Flexible product data
-- ---------------------------------------------------------------------------
-- `images` may already exist on hosted databases with another type (text[] / text); normalise to jsonb.
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'images';
  IF t = 'ARRAY' THEN
    ALTER TABLE products ALTER COLUMN images DROP DEFAULT;
    ALTER TABLE products ALTER COLUMN images TYPE jsonb USING COALESCE(to_jsonb(images), '[]'::jsonb);
  ELSIF t IN ('text', 'character varying') THEN
    ALTER TABLE products ALTER COLUMN images DROP DEFAULT;
    ALTER TABLE products ALTER COLUMN images TYPE jsonb USING CASE WHEN images IS NULL OR images = '' THEN '[]'::jsonb WHEN left(images, 1) = '[' THEN images::jsonb ELSE jsonb_build_array(images) END;
  END IF;
END $$;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE products SET images = '[]'::jsonb WHERE images IS NULL;
ALTER TABLE products ALTER COLUMN images SET DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS care_instructions text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_label text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_price_nonnegative') THEN
    ALTER TABLE products ADD CONSTRAINT products_price_nonnegative CHECK (price_inr >= 0) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Product variants: one purchasable unit = one variant (size + attributes),
-- each with its own SKU, price, optional sale price and stock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  size_label text NOT NULL DEFAULT 'Free Size',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_inr numeric(12,2) NOT NULL CHECK (price_inr >= 0),
  sale_price_inr numeric(12,2) CHECK (sale_price_inr IS NULL OR (sale_price_inr >= 0 AND sale_price_inr <= price_inr)),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku ON product_variants (lower(sku));
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_definition ON product_variants (product_id, lower(size_label), attributes);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id, is_active, sort_order);

-- Backfill: every existing product becomes purchasable through exactly one default variant.
-- Stock mirrors the previous one-of-one inventory status (available = 1, otherwise 0).
INSERT INTO product_variants (product_id, sku, size_label, price_inr, stock_quantity, is_active)
SELECT p.id,
       'VS-' || upper(substr(replace(p.id::text, '-', ''), 1, 12)),
       COALESCE(NULLIF(trim(p.size_label), ''), 'Free Size'),
       GREATEST(p.price_inr, 0),
       CASE WHEN EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') THEN 1 ELSE 0 END,
       true
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Cart: line items reference a variant
-- ---------------------------------------------------------------------------
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
DELETE FROM cart_items ci WHERE NOT EXISTS (SELECT 1 FROM carts c WHERE c.id = ci.cart_id);
DELETE FROM cart_items ci WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = ci.product_id);
UPDATE cart_items ci SET variant_id = (
  SELECT v.id FROM product_variants v WHERE v.product_id = ci.product_id ORDER BY v.sort_order, v.created_at LIMIT 1
) WHERE ci.variant_id IS NULL;
DELETE FROM cart_items WHERE variant_id IS NULL;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_cart_variant ON cart_items (cart_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items (cart_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_fk') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_fk FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_fk') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_product_fk') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_quantity_range') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 10) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Orders: explicit payment state, idempotency, server-computed tax breakdown
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_fingerprint text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paise integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_failure_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS igst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS place_of_supply text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_gstin text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel text DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method text DEFAULT 'delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency ON orders (auth_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_razorpay_order ON orders (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_razorpay_payment ON orders (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_pending_expiry ON orders (payment_expires_at) WHERE payment_status = 'pending';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_status_valid CHECK (status IN
      ('pending_payment','processing','packed','dispatched','delivered','cancelled','expired','refund_required','refunded')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_status_valid CHECK (payment_status IN
      ('pending','paid','failed','cancelled','expired','refund_required','refunded')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_amounts_nonnegative') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_amounts_nonnegative CHECK (subtotal >= 0 AND shipping_fee >= 0 AND total >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_label text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total numeric(12,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS taxable_value numeric(12,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_size text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS use_credit boolean DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_fk') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_fk') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_quantity_positive') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0 AND unit_price >= 0) NOT VALID;
  END IF;
END $$;
-- order_items must survive product deletion (they are the sales/invoice record)
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Inventory reservations: stock is decremented atomically when checkout starts and
-- either committed on verified payment or released on expiry/failure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','committed','released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expiry ON inventory_reservations (expires_at) WHERE status = 'held';

-- ---------------------------------------------------------------------------
-- Razorpay webhook idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'razorpay',
  event_id text NOT NULL,
  event_type text NOT NULL,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Passwordless OTP (hashed; one active code per email; attempt-limited)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_otps (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  send_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

-- Server-side session revocation: tokens issued before this instant are rejected.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email ON profiles (lower(email)) WHERE email IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Duplicate profile emails exist; creating non-unique index instead';
  CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (lower(email));
END $$;

-- ---------------------------------------------------------------------------
-- Membership payments & credit ledger idempotency
-- ---------------------------------------------------------------------------
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE membership_payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_payments_rzp_order ON membership_payments (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_payments_rzp_payment ON membership_payments (provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_membership_payments_membership ON membership_payments (membership_id, attempted_at DESC);

ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS membership_payment_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_membership_payment ON credit_ledger (membership_payment_id) WHERE membership_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_order_reason ON credit_ledger (order_id, reason) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_membership ON credit_ledger (membership_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_credits_nonnegative') THEN
    ALTER TABLE memberships ADD CONSTRAINT memberships_credits_nonnegative CHECK (credits_balance >= 0) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- GST invoices: unique numbering, one invoice per order / membership payment
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS igst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS total_amount numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS place_of_supply text;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS buyer_name text;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS buyer_gstin text;
ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS seller_gstin text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_records_order ON invoice_records (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_records_membership_payment ON invoice_records (membership_payment_id) WHERE membership_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Exchanges: one open request per order
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_exchanges_user ON exchanges (auth_user_id, created_at DESC);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_exchanges_open_per_order ON exchanges (order_id) WHERE status IN ('requested','review');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Existing duplicate open exchanges; uniqueness enforced in application only';
END $$;

-- ---------------------------------------------------------------------------
-- Piece requests: full workflow status set
-- ---------------------------------------------------------------------------
ALTER TABLE piece_requests DROP CONSTRAINT IF EXISTS piece_requests_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'piece_requests_status_valid') THEN
    ALTER TABLE piece_requests ADD CONSTRAINT piece_requests_status_valid CHECK (status IN (
      'NEW','REVIEWING','CONTACTED','SOURCING','AVAILABLE','QUOTE_SENT','RESERVED','CONVERTED','FULFILLED',
      'CLOSED','REJECTED','NOT_AVAILABLE','CUSTOMER_NOT_RESPONDED','CANCELLED'));
  END IF;
END $$;
DROP POLICY IF EXISTS customer_insert_piece_requests ON piece_requests;
DROP POLICY IF EXISTS customer_select_own_piece_requests ON piece_requests;
DROP POLICY IF EXISTS admin_select_all_piece_requests ON piece_requests;
DROP POLICY IF EXISTS admin_update_all_piece_requests ON piece_requests;

-- ---------------------------------------------------------------------------
-- Customer content
-- ---------------------------------------------------------------------------
ALTER TABLE feedback_videos ADD COLUMN IF NOT EXISTS duration_seconds numeric(6,2);
ALTER TABLE feedback_videos ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE feedback_videos ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_feedback_videos_active ON feedback_videos (active, sort_order);
CREATE INDEX IF NOT EXISTS idx_instagram_content_active ON instagram_content (active, sort_order);

-- ---------------------------------------------------------------------------
-- Query-pattern indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_live ON products (featured DESC, created_at DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_colour_reviews_user ON colour_reviews (auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wearer_profiles_user ON wearer_profiles (auth_user_id);

-- ---------------------------------------------------------------------------
-- Settings used by the server-side pricing engine
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
  ('seller_state', '"Karnataka"'),
  ('seller_gstin', '""'),
  ('reservation_minutes', '15'),
  ('max_published_videos', '3'),
  ('max_video_seconds', '30')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Hosted Postgres (Supabase) lockdown. The browser must never talk to the database
-- directly; the anon/authenticated PostgREST roles get no table access.
-- The Express server connects as the table owner and is unaffected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  END IF;
END $$;
