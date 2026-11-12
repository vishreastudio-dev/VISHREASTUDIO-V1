-- Membership and referral rules correction (requirements MEM-10, LOY-03):
-- * the 6th-month free piece follows consecutive paid months, prepaid or renewed, not only month 6
--   of a 6-month prepaid plan;
-- * a renewal paid within the grace period after the paid period ends keeps the consecutive count;
-- * the referrer's free piece is earned by the referred customer's first membership payment of any
--   duration (the ₹150 welcome discount stays limited to the 2-month membership).
-- Forward-only and idempotent; no rows are deleted.

UPDATE app_settings SET value = '"consecutive_months"'::jsonb
 WHERE key = 'six_month_reward_qualification' AND value = '"six_month_plan"'::jsonb;

INSERT INTO app_settings (key, value) VALUES ('renewal_grace_days', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Referrals whose referred customer already paid a first, undiscounted membership (e.g. 6 months)
-- were left 'attributed' and the referrer was never rewarded. Qualify them now, on that first payment
-- if it was not refunded, and issue the referrer's reward(s) with an audit record.
WITH first_payment AS (
  SELECT DISTINCT ON (auth_user_id) id, auth_user_id, status, discount_amount
    FROM membership_payments
   WHERE status IN ('paid', 'refunded')
   ORDER BY auth_user_id, paid_at NULLS LAST, attempted_at
),
qualified AS (
  UPDATE referrals r
     SET status = 'qualified', qualified_at = now(), qualifying_payment_id = fp.id,
         discount_amount = COALESCE(fp.discount_amount, 0), updated_at = now()
    FROM first_payment fp
   WHERE fp.auth_user_id = r.referred_user_id AND fp.status = 'paid' AND r.status = 'attributed'
  RETURNING r.id, r.referrer_user_id, fp.id AS payment_id
),
quantity AS (
  SELECT LEAST(5, GREATEST(1, COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key = 'referrer_reward_quantity'), 1))) AS n
),
issued AS (
  INSERT INTO reward_entitlements (auth_user_id, kind, referral_id, sequence_no, source_payment_id)
  SELECT q.referrer_user_id, 'referral', q.id, s.n, q.payment_id
    FROM qualified q CROSS JOIN quantity CROSS JOIN LATERAL generate_series(1, quantity.n) AS s(n)
  ON CONFLICT (referral_id, sequence_no) WHERE kind = 'referral' DO NOTHING
  RETURNING id, referral_id
)
INSERT INTO audit_logs (auth_user_id, action, entity_type, entity_id, details)
SELECT 'system', 'referral_qualified', 'referral', q.id::text,
       jsonb_build_object('backfill', '018_membership_rules_correction',
                          'reward_ids', COALESCE((SELECT jsonb_agg(i.id) FROM issued i WHERE i.referral_id = q.id), '[]'::jsonb))
  FROM qualified q;
