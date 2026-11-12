-- Order tracking: courier, milestone timestamps and refund reference.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_partner text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_refund_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_notified_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_courier_partner_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_courier_partner_valid CHECK (courier_partner IS NULL OR courier_partner IN
      ('Delhivery','BlueDart','DTDC','Shiprocket','India Post','Studio Pickup','Other')) NOT VALID;
  END IF;
END $$;
