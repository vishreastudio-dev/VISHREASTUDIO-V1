-- Migration 026: First-time user profile onboarding, customer analytics, and loyalty tenure tracking

ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS preferred_silhouette TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS style_notes TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS tenure_rewards_sent JSONB DEFAULT '[]'::jsonb;

-- Mark existing profiles with contact info as already completed so returning customers are not blocked
UPDATE customer_profiles
SET profile_completed = true, onboarding_completed = true
WHERE phone IS NOT NULL AND phone != '' AND profile_completed IS NOT TRUE;

-- Add index on orders for customer lifetime value / total spend calculations
CREATE INDEX IF NOT EXISTS idx_orders_user_paid ON orders(auth_user_id, payment_status) WHERE payment_status = 'paid';

-- Ensure loyalty_events has a details jsonb column if missing
ALTER TABLE loyalty_events ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;
