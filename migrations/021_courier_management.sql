-- Migration 021: courier companies managed from the admin panel, and shipment history.
-- Additive only. Existing orders keep their courier name and tracking number; the fixed list of
-- seven courier names becomes rows the owner can edit, deactivate or extend without a deployment.

CREATE TABLE IF NOT EXISTS couriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  contact_person text,
  contact_phone text,
  website text,
  -- `{tracking}` is replaced with the URL-encoded AWB; without it the URL is a static tracking page.
  tracking_url_template text,
  service_description text,
  service_areas text,
  requires_tracking boolean NOT NULL DEFAULT true,
  is_pickup boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_couriers_name ON couriers (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_couriers_active ON couriers (is_active, sort_order, name);

-- The couriers previously hard-coded in the application, with the same tracking pages.
INSERT INTO couriers (name, website, tracking_url_template, requires_tracking, is_pickup, sort_order) VALUES
  ('Delhivery', 'https://www.delhivery.com', 'https://www.delhivery.com/track/package/{tracking}', true, false, 10),
  ('BlueDart', 'https://www.bluedart.com', 'https://www.bluedart.com/web/guest/trackdartresultthirdparty?trackFor=0&trackNo={tracking}', true, false, 20),
  ('DTDC', 'https://www.dtdc.in', 'https://txk.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCITrackingDetails&cType=Consignment&cnNo={tracking}', true, false, 30),
  ('Shiprocket', 'https://www.shiprocket.in', 'https://shiprocket.co/tracking/{tracking}', true, false, 40),
  ('India Post', 'https://www.indiapost.gov.in', 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx', true, false, 50),
  ('Studio Pickup', NULL, NULL, false, true, 60),
  ('Other', NULL, NULL, false, false, 70)
ON CONFLICT DO NOTHING;

-- Orders reference the courier row and keep a snapshot of the name and link used at dispatch, so
-- renaming, re-templating or deactivating a courier never rewrites shipment history.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_id uuid REFERENCES couriers(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_courier_partner_valid;
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders (courier_id) WHERE courier_id IS NOT NULL;

UPDATE orders o SET courier_id = c.id
  FROM couriers c
 WHERE o.courier_id IS NULL AND o.courier_partner IS NOT NULL AND lower(btrim(c.name)) = lower(btrim(o.courier_partner));

-- Links for already-dispatched orders, only where the AWB needs no URL encoding.
UPDATE orders o SET tracking_url = CASE WHEN position('{tracking}' IN c.tracking_url_template) > 0
                                        THEN replace(c.tracking_url_template, '{tracking}', o.tracking_number)
                                        ELSE c.tracking_url_template END
  FROM couriers c
 WHERE o.courier_id = c.id AND o.tracking_url IS NULL AND c.tracking_url_template IS NOT NULL
   AND o.tracking_number ~ '^[A-Za-z0-9-]{1,80}$';

-- Append-only record of every fulfilment change (status, courier, AWB) made by the studio.
CREATE TABLE IF NOT EXISTS order_shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  courier_id uuid REFERENCES couriers(id) ON DELETE RESTRICT,
  courier_name text,
  tracking_number text,
  tracking_url text,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_shipment_events_order ON order_shipment_events (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_shipment_events_courier ON order_shipment_events (courier_id) WHERE courier_id IS NOT NULL;

-- Same hosted-Postgres lockdown as migration 020 for the new tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_shipment_events ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON couriers, order_shipment_events FROM anon, authenticated;
  END IF;
END $$;
