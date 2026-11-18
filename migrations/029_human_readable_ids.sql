-- Migration 029: Concurrency-Safe Automatic Human-Readable IDs across Admin Modules
-- ID Pattern: PREFIX-YYYY-NNN (e.g. VEN-2026-001, CUST-2026-001, CAT-2026-001, PROD-2026-001, INV-2026-001, SALE-2026-001, ORD-2026-001, PO-2026-001, MEM-2026-001, GIFT-2026-001, EXC-2026-001)

-- 1. Atomic Sequence Tracking Table
CREATE TABLE IF NOT EXISTS id_sequences (
  prefix text NOT NULL,
  year integer NOT NULL,
  current_val integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (prefix, year)
);

-- 2. Add Human-Readable ID Columns (with unique indices)
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS customer_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_customer_code ON customer_profiles (customer_code) WHERE customer_code IS NOT NULL;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS category_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_category_code ON categories (category_code) WHERE category_code IS NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_code ON products (product_code) WHERE product_code IS NOT NULL;

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS inventory_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_inventory_code ON inventory (inventory_code) WHERE inventory_code IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number) WHERE order_number IS NOT NULL;

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS membership_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_membership_code ON memberships (membership_code) WHERE membership_code IS NOT NULL;

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS gift_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gifts_gift_code ON gifts (gift_code) WHERE gift_code IS NOT NULL;

ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS exchange_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchanges_exchange_code ON exchanges (exchange_code) WHERE exchange_code IS NOT NULL;

-- 3. Safe Backfill for Existing Records (preserving all existing PKs and FKs)
DO $$
DECLARE
  rec RECORD;
  seq INT;
  curr_yr INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
BEGIN
  -- 3.1 Backfill Customers (CUST)
  seq := 0;
  FOR rec IN SELECT id FROM customer_profiles WHERE customer_code IS NULL ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE customer_profiles SET customer_code = 'CUST-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('CUST', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.2 Backfill Categories (CAT)
  seq := 0;
  FOR rec IN SELECT id FROM categories WHERE category_code IS NULL ORDER BY sort_order ASC, name ASC LOOP
    seq := seq + 1;
    UPDATE categories SET category_code = 'CAT-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('CAT', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.3 Backfill Products (PROD)
  seq := 0;
  FOR rec IN SELECT id FROM products WHERE product_code IS NULL ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE products SET product_code = 'PROD-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('PROD', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.4 Backfill Inventory (INV)
  seq := 0;
  FOR rec IN SELECT id FROM inventory WHERE inventory_code IS NULL ORDER BY updated_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE inventory SET inventory_code = 'INV-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('INV', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.5 Backfill Orders: Web Orders (ORD) and Studio Sales (SALE)
  -- Studio Sales
  seq := 0;
  FOR rec IN SELECT id FROM orders WHERE order_number IS NULL AND channel = 'studio' ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE orders SET order_number = 'SALE-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('SALE', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- Web Orders
  seq := 0;
  FOR rec IN SELECT id FROM orders WHERE order_number IS NULL AND (channel IS NULL OR channel != 'studio') ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE orders SET order_number = 'ORD-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('ORD', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.6 Backfill Vendors (VEN)
  seq := 0;
  FOR rec IN SELECT id FROM vendors ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE vendors SET vendor_code = 'VEN-' || curr_yr || '-' || LPAD(seq::text, 3, '0'), code = 'VEN-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('VEN', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.7 Backfill Purchase Orders (PO)
  seq := 0;
  FOR rec IN SELECT id FROM purchase_orders ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE purchase_orders SET po_number = 'PO-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('PO', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.8 Backfill Memberships (MEM)
  seq := 0;
  FOR rec IN SELECT id FROM memberships WHERE membership_code IS NULL ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE memberships SET membership_code = 'MEM-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('MEM', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.9 Backfill Gifts (GIFT)
  seq := 0;
  FOR rec IN SELECT id FROM gifts WHERE gift_code IS NULL ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE gifts SET gift_code = 'GIFT-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('GIFT', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

  -- 3.10 Backfill Exchanges (EXC)
  seq := 0;
  FOR rec IN SELECT id FROM exchanges WHERE exchange_code IS NULL ORDER BY created_at ASC, id ASC LOOP
    seq := seq + 1;
    UPDATE exchanges SET exchange_code = 'EXC-' || curr_yr || '-' || LPAD(seq::text, 3, '0') WHERE id = rec.id;
  END LOOP;
  IF seq > 0 THEN
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ('EXC', curr_yr, seq, now())
    ON CONFLICT (prefix, year) DO UPDATE SET current_val = GREATEST(id_sequences.current_val, EXCLUDED.current_val);
  END IF;

END $$;
