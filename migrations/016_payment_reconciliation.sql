-- Payment reconciliation: record whether the gateway confirmed a payment, and bound refund retries.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gateway_checked_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_refund_pending ON orders (refund_attempted_at) WHERE payment_status = 'refund_required';
CREATE INDEX IF NOT EXISTS idx_orders_gateway_unchecked ON orders (paid_at) WHERE payment_status = 'paid' AND gateway_checked_at IS NULL;

-- Orders paid before this column existed were processed by the earlier path; do not re-fetch history.
UPDATE orders SET gateway_checked_at = COALESCE(paid_at, now()) WHERE payment_status = 'paid' AND gateway_checked_at IS NULL;
