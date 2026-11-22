-- Migration 028: Business Management Modules (Vendors, Procurement, Inventory, Sales, CRM)

-- 1. Vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code text UNIQUE,
  code text,
  name text NOT NULL,
  contact_name text,
  contact_person text,
  contact_phone text,
  phone text,
  email text,
  address text,
  categories jsonb DEFAULT '[]'::jsonb,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_code text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address text;

CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors (lower(name));
CREATE INDEX IF NOT EXISTS idx_vendors_phone ON vendors (contact_phone);

-- 2. Purchase Orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  order_date date NOT NULL DEFAULT current_date,
  batch_id text NOT NULL,
  courier_charges numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  grand_total numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unfulfilled', -- 'unfulfilled', 'fulfilled', 'cancelled'
  fulfilled_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders (order_date DESC);

-- 3. Purchase Order Items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  category text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items (purchase_order_id);

-- 4. Extend products for inventory costing & procurement fields
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS batch_id text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_quantity integer DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_price_per_piece numeric(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS courier_charge numeric(12,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 2;

-- 5. Extend customer_profiles for notes and tags
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'::jsonb;
ALTER TABLE carts ADD COLUMN IF NOT EXISTS applied_promo_code text;

-- 6. Extend orders for in-studio counter sales & financial tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_due numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sale_date date DEFAULT current_date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_profit numeric(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount numeric(12,2) DEFAULT 0;

-- 7. Seed demo vendors from sourcing batches if none exist
INSERT INTO vendors (vendor_code, name, contact_name, contact_phone, categories, notes)
SELECT 'VEND-001', 'Silk & Heritage Weaves', 'Ramesh Kumar', '9845012345', '["Sarees", "Fabrics"]'::jsonb, 'Premier handloom supplier'
WHERE NOT EXISTS (SELECT 1 FROM vendors LIMIT 1);

INSERT INTO vendors (vendor_code, name, contact_name, contact_phone, categories, notes)
SELECT 'VEND-002', 'Atelier Karnataka Cottons', 'Geetha Devi', '9845098765', '["Dresses", "Co-ords"]'::jsonb, 'Organic cotton and natural dyed garments'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE vendor_code = 'VEND-002');
