
-- File: 001_initial.sql
CREATE TABLE IF NOT EXISTS profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id TEXT UNIQUE, full_name TEXT, phone TEXT, email TEXT, is_admin BOOLEAN DEFAULT false, role TEXT DEFAULT 'customer', is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());

-- File: 002_catalogue.sql
CREATE TABLE IF NOT EXISTS categories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, parent_id UUID REFERENCES categories(id), is_active BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id UUID REFERENCES categories(id), name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, price_inr NUMERIC(12,2) NOT NULL DEFAULT 0, is_one_of_one BOOLEAN DEFAULT true, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS inventory (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID UNIQUE REFERENCES products(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'available', reserved_until TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now());

-- File: 003_commerce.sql
CREATE TABLE IF NOT EXISTS customer_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL UNIQUE, full_name text, phone text, email text, gst_number text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS wearer_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, name text NOT NULL, relationship text, skin_tone text, undertone text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS carts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL UNIQUE, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cart_id uuid NOT NULL, product_id uuid NOT NULL, quantity integer NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now(), UNIQUE(cart_id,product_id)); CREATE TABLE IF NOT EXISTS orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, status text NOT NULL DEFAULT 'pending_payment', payment_status text NOT NULL DEFAULT 'pending', subtotal numeric(12,2) NOT NULL DEFAULT 0, shipping_fee numeric(12,2) NOT NULL DEFAULT 99, total numeric(12,2) NOT NULL DEFAULT 99, shipping_address jsonb, gst_invoice_requested boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, product_id uuid NOT NULL, product_name text NOT NULL, unit_price numeric(12,2) NOT NULL, quantity integer NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS exchanges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, auth_user_id text NOT NULL, reason text, status text NOT NULL DEFAULT 'requested', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'inactive', monthly_price numeric(12,2) NOT NULL DEFAULT 1799, credits_per_month integer NOT NULL DEFAULT 4, credits_balance integer NOT NULL DEFAULT 0, renewal_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS wardrobe_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, product_id uuid NOT NULL, saved_at timestamptz DEFAULT now(), UNIQUE(auth_user_id,product_id));

-- File: 004_product_content.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text; ALTER TABLE products ADD COLUMN IF NOT EXISTS badge text; ALTER TABLE products ADD COLUMN IF NOT EXISTS material text; ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes jsonb DEFAULT '["XS","S","M","L","XL"]'::jsonb; ALTER TABLE products ADD COLUMN IF NOT EXISTS color text; ALTER TABLE products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false; CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug); CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id); CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory(product_id,status);

-- File: 005_v1_catalogue_seed.sql
INSERT INTO categories(name,slug,parent_id,is_active,sort_order) VALUES ('Tops','tops',NULL,true,1),('Dresses','dresses',NULL,true,2),('Skirts','skirts',NULL,true,3),('Pants','pants',NULL,true,4),('Crop Tops','crop-tops',NULL,true,5),('Party Dresses','party-dresses',NULL,true,6),('Coord Sets','coord-sets',NULL,true,7),('Sweaters','sweaters',NULL,true,8),('Long Coats & Shrugs','long-coats-shrugs',NULL,true,9),('Sweatshirts & Hoodies','sweatshirts-hoodies',NULL,true,10),('Cardigans','cardigans',NULL,true,11) ON CONFLICT DO NOTHING;

-- File: 006_v1_demo_products.sql
INSERT INTO products(category_id,name,slug,description,price_inr,is_one_of_one,is_active,badge,material,color,featured) SELECT c.id,x.name,x.slug,x.description,x.price,true,true,x.badge,x.material,x.color,x.featured FROM categories c JOIN (VALUES ('Tops','Sculpted Everyday Top','sculpted-everyday-top','A clean, structured top with an easy everyday silhouette.',1890,'NEW','Soft structured fabric','Ivory',true),('Dresses','The Wine Slip Dress','the-wine-slip-dress','A fluid evening silhouette in Vishrea wine.',3490,'EDITORIAL','Fluid satin blend','Wine',true),('Coord Sets','Soft Structure Coord','soft-structure-coord','A considered matching set made for effortless dressing.',4290,'NEW','Textured crepe','Stone',true),('Pants','Tailored Wide-Leg Pant','tailored-wide-leg-pant','A relaxed wide-leg trouser with a tailored finish.',2790,NULL,'Tailored twill','Black',false),('Party Dresses','After Hours Dress','after-hours-dress','A refined party silhouette for after-dark plans.',3990,'LIMITED','Satin blend','Burgundy',true),('Cardigans','Relaxed Knit Cardigan','relaxed-knit-cardigan','Soft knit layering with a clean contemporary line.',2490,NULL,'Fine knit','Oat',false),('Crop Tops','Everyday Crop Top','everyday-crop-top','A versatile cropped layer designed to pair across the wardrobe.',1590,NULL,'Cotton stretch','Pearl',false),('Long Coats & Shrugs','Longline Shrug','longline-shrug','A fluid long layer for finishing a look.',3290,NULL,'Lightweight weave','Charcoal',false)) x(cat,name,slug,description,price,badge,material,color,featured) ON c.name=x.cat WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug=x.slug);

-- File: 007_v1_inventory_seed.sql
INSERT INTO inventory(product_id,status) SELECT p.id,'available' FROM products p WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id=p.id);

-- File: 008_v1_operations.sql
CREATE TABLE IF NOT EXISTS offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, title text NOT NULL, description text, discount_type text NOT NULL DEFAULT 'percentage', discount_value numeric(12,2) NOT NULL DEFAULT 0, active boolean DEFAULT true, starts_at timestamptz, ends_at timestamptz, created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS referrals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_user_id text NOT NULL, referred_email text, referral_code text NOT NULL, status text NOT NULL DEFAULT 'shared', created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS gifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, recipient_name text NOT NULL, recipient_email text, message text, delivery_method text NOT NULL DEFAULT 'email', amount numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS store_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_name text DEFAULT 'Vishrea Studio', pickup_enabled boolean DEFAULT true, pickup_note text, updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS instagram_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, post_url text NOT NULL, image_url text, active boolean DEFAULT true, sort_order integer DEFAULT 0, created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS feedback_videos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, video_url text NOT NULL, active boolean DEFAULT true, sort_order integer DEFAULT 0, created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS colour_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, undertone text, palette jsonb, source text DEFAULT 'v1_review', raw_image_key text, created_at timestamptz DEFAULT now());

-- File: 009_colour_analysis_v1.sql
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS model_version text DEFAULT 'vishrea-colour-engine-1.0';
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS confidence numeric(5,2);
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS quality_score numeric(5,2);
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS lighting text;

-- File: 010_production_v1.sql
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS age_confirmed boolean DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS marketing_opt_in boolean DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean DEFAULT false;
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS size_label text;
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS bust_cm numeric(8,2);
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS waist_cm numeric(8,2);
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS hip_cm numeric(8,2);
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS length_cm numeric(8,2);
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS style_preferences jsonb DEFAULT '{}'::jsonb;
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS occasion_preferences jsonb DEFAULT '{}'::jsonb;
ALTER TABLE wearer_profiles ADD COLUMN IF NOT EXISTS birthday date;
ALTER TABLE products ADD COLUMN IF NOT EXISTS occasion text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS colour_season text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS bust_cm numeric(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS waist_cm numeric(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS hip_cm numeric(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm numeric(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price_inr numeric(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_name text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code text DEFAULT '6204';
ALTER TABLE products ADD COLUMN IF NOT EXISTS listed_at timestamptz DEFAULT now();
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalogue_image_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS drop_id uuid;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS sold_at timestamptz;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS sold_channel text;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS quality_status text DEFAULT 'good';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel text DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method text DEFAULT 'delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_packing_fee numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) DEFAULT 0;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS claim_type text DEFAULT 'not_liked';
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS evidence_urls jsonb DEFAULT '[]'::jsonb;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS quality_check text;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS return_tracking text;
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS addresses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, label text DEFAULT 'Home', recipient_name text, phone text, line1 text, line2 text, city text, state text, pincode text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, wearer_id uuid, membership_id uuid, delta integer NOT NULL, reason text NOT NULL, expires_at timestamptz, order_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS membership_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), membership_id uuid NOT NULL, auth_user_id text NOT NULL, amount numeric(12,2) NOT NULL, status text NOT NULL DEFAULT 'pending', provider text DEFAULT 'razorpay', provider_payment_id text, provider_subscription_id text, attempt_no integer DEFAULT 1, attempted_at timestamptz DEFAULT now(), failure_reason text, raw_reference jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS loyalty_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, audience jsonb DEFAULT '{}'::jsonb, trigger_config jsonb DEFAULT '{}'::jsonb, reward_config jsonb DEFAULT '{}'::jsonb, applies_to jsonb DEFAULT '{}'::jsonb, limits jsonb DEFAULT '{}'::jsonb, starts_at timestamptz, ends_at timestamptz, active boolean DEFAULT false, estimated_monthly_cost numeric(12,2) DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS loyalty_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_id uuid, auth_user_id text, order_id uuid, event_type text, reward_value numeric(12,2) DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS sourcing_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_name text NOT NULL, batch_date date DEFAULT current_date, notes text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS product_sources (product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, sourcing_batch_id uuid REFERENCES sourcing_batches(id), supplier_name text, cost_price_inr numeric(12,2), purchased_at date, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text, action text NOT NULL, entity_type text, entity_id text, details jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS drop_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, starts_at timestamptz NOT NULL, public_at timestamptz NOT NULL, active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS product_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, photo_type text NOT NULL, image_url text NOT NULL, catalogue_safe boolean DEFAULT false, sort_order integer DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS notification_preferences (auth_user_id text PRIMARY KEY, whatsapp boolean DEFAULT true, email boolean DEFAULT true, sms boolean DEFAULT true, marketing boolean DEFAULT false, updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS invoice_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, membership_payment_id uuid, invoice_number text UNIQUE NOT NULL, gst_rate numeric(5,2), taxable_value numeric(12,2), gst_amount numeric(12,2), hsn_summary jsonb DEFAULT '[]'::jsonb, issued_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS saved_looks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, wearer_id uuid, name text NOT NULL, share_token text UNIQUE, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS saved_look_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), look_id uuid NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id), created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS story_consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text NOT NULL, content_url text, consented boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS store_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, sold_by text NOT NULL, payment_mode text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pricing_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, markup_percent numeric(8,2) DEFAULT 100, min_margin_percent numeric(8,2) DEFAULT 30, active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS legal_pages (slug text PRIMARY KEY, title text NOT NULL, body text NOT NULL, updated_at timestamptz DEFAULT now());
INSERT INTO app_settings(key,value) VALUES
('membership_price','1799'),('membership_upfront_months','2'),('credits_per_month','4'),('credit_expiry_days','60'),('pause_months','1'),('pause_frequency_months','6'),('autopay_retries','3'),('autopay_retry_days','5'),('early_access_hours','48'),('payment_lock_minutes','5'),('offer_after_days','21'),('free_member_credits_to_ship','4'),('shipping_fee','99'),('gift_packing_fee','50'),('exchange_days','7'),('damage_report_hours','24'),('dispatch_hours','48'),('gst_threshold','2500'),('gst_rate_low','5'),('gst_rate_high','18'),('cod_enabled','false'),('max_wearers','5'),('drop_public_at','""')
ON CONFLICT(key) DO NOTHING;
INSERT INTO store_settings(store_name,pickup_enabled,pickup_note) SELECT 'Vishrea Studio',true,'Free studio pickup · The Studio is your Walkin Wardrobe' WHERE NOT EXISTS (SELECT 1 FROM store_settings);
INSERT INTO pricing_rules(name,markup_percent,min_margin_percent,active) SELECT 'Default markup',100,30,true WHERE NOT EXISTS (SELECT 1 FROM pricing_rules);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(auth_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_season_size ON products(colour_season,occasion,is_active);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- File: 011_payments_and_membership.sql
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS consecutive_paid_months integer DEFAULT 0;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS pause_used_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS autopay_subscription_id text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS upfront_months integer DEFAULT 2;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS gift boolean DEFAULT false;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS gift_mode text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS gift_message text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS gift_start_at date;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS prepaid_months integer DEFAULT 0;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS failed_retry_count integer DEFAULT 0;
CREATE TABLE IF NOT EXISTS payment_locks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, order_id uuid, auth_user_id text, locked_until timestamptz NOT NULL, status text NOT NULL DEFAULT 'locked', created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_payment_lock_product ON payment_locks(product_id) WHERE status='locked';
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS selected_size text;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS use_credit boolean DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_size text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS use_credit boolean DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature text;
CREATE INDEX IF NOT EXISTS idx_payment_locks_expiry ON payment_locks(locked_until,status);

-- File: 012_piece_requests.sql
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

-- Enable Row Level Security (RLS)
ALTER TABLE piece_requests ENABLE ROW LEVEL SECURITY;

-- Customer can create own request (authenticated or anonymous with email verification)
DROP POLICY IF EXISTS customer_insert_piece_requests ON piece_requests;
CREATE POLICY customer_insert_piece_requests ON piece_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NULL OR customer_id = auth.uid()::text
  );

-- Customer can view their own requests (cannot see other customers' requests)
DROP POLICY IF EXISTS customer_select_own_piece_requests ON piece_requests;
CREATE POLICY customer_select_own_piece_requests ON piece_requests
  FOR SELECT
  USING (
    customer_id = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.auth_user_id = auth.uid()::text AND (profiles.is_admin = true OR profiles.role = 'admin')
    )
  );

-- Admin can view all requests
DROP POLICY IF EXISTS admin_select_all_piece_requests ON piece_requests;
CREATE POLICY admin_select_all_piece_requests ON piece_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.auth_user_id = auth.uid()::text AND (profiles.is_admin = true OR profiles.role = 'admin')
    )
  );

-- Admin can update all requests
DROP POLICY IF EXISTS admin_update_all_piece_requests ON piece_requests;
CREATE POLICY admin_update_all_piece_requests ON piece_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.auth_user_id = auth.uid()::text AND (profiles.is_admin = true OR profiles.role = 'admin')
    )
  );

