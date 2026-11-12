# Membership payment failure investigation

Date: 2026-11-11. QA only (`127.0.0.1:3100`, stand-in `127.0.0.1:3190`). No live Razorpay charge, no production database, no commit.

## Original symptom

On `/membership`, Razorpay Checkout opened in Test Mode, showed **Payment Failed**, and the app then showed its generic error page (“This page didn’t load properly.”).

## Root cause

The isolated QA server creates membership checkouts on the **local Razorpay stand-in** (`RAZORPAY_API_BASE=http://127.0.0.1:3190`, key `rzp_test_qa_standin`). `start_checkout` stores a stand-in subscription id (`sub_…`).

The browser always loaded `https://checkout.razorpay.com/v1/checkout.js` and passed that stand-in `subscription_id` to **Razorpay’s hosted checkout**. Those ids do not exist on Razorpay, so Test Mode fails the payment. The stand-in was never asked to capture anything.

That is a mix of the two gateways, not a wrong price and not a bad HMAC on a real payment. The generic page is the React error boundary; closing the failed hosted window was not a verified membership activation.

The membership model in code is unchanged: the plan on sale is **2 months upfront, ₹3,598**, then UPI Autopay at ₹1,799. `calculateMembershipPrice` can price 6 × ₹1,799 = ₹10,794, but `membership_plan_months` only offers 2 months, and `test/remediation.test.js` expects `months: 6` to return 400. Credits issued at purchase are **4** (the first paid month). The sixth-month free piece is still issued when that paid month begins, not at purchase. This pass did not switch the product to “no autopay”.

## Kiro changes reviewed

Kept:

- `api/payment-verify.js`: the manual 409 bodies for `duplicate_payment` and `order_unfulfillable` now include `request_id`, matching `lib/http.js`.
- `lib/payments.js`: re-read the order after the invoice number is written so the verify response can return it.

Not rejected and not reverted: the rest of the working tree (SEO, storage, catalogue, Postman collection, docs). The Postman file is untracked. No Newman result file was found under `scratch/`, so that run is **not** reported as passed. Cache-Control assertion edits were not treated as proof the API matches them.

## Fix

When `RAZORPAY_API_BASE` is `127.0.0.1` or `localhost`, the checkout payload sets `razorpay.checkout_mode = "local"`. The membership page does **not** load Razorpay’s script. It shows an inline stand-in: confirm, simulate failure, or cancel.

`POST /api/membership` `action: complete_local_checkout` exists only in that local mode. It registers the payment on the stand-in, builds the same subscription HMAC the hosted handler would, and runs the existing `verifyCheckout` path. A failed outcome returns 400 `payment_not_captured` with `request_id` and leaves the membership pending. A second confirm returns 409 `checkout_not_open` and does not add credits. Production (`api.razorpay.com`) does not get `checkout_mode` and does not expose this action (`404`).

The QA stand-in now stores subscriptions and serves `GET /subscriptions/:id` and `POST /__checkout`. Previously every `/subscriptions` call invented a new id, so a later fetch could not see the mandate.

## Files

- `lib/config.js`, `lib/razorpay.js`, `lib/billing.js`, `api/membership.js`
- `tests/qa/razorpay-standin.mjs`, `test/helpers.js`
- `vishrea-react/src/pages/Membership.jsx`
- `test/remediation.test.js` (one new test)
- QA processes restarted so port 3100 and 3190 load this code

Kiro’s `payment-verify.js` and `lib/payments.js` edits were left in place.

## Tests actually run

| Check | Result |
|---|---|
| `node --test --test-name-pattern "local stand-in checkout" test/remediation.test.js` | **1 passed**, 0 failed |
| QA API, `qa-user-2@qa.test`, after restart | login 200; plan `[2]` total 3598; checkout 200 `checkout_mode: local`; failed outcome 400 `payment_not_captured` with `request_id`, status stays `pending_payment`; confirm 200 `active`, **4** credits; repeat 409 `checkout_not_open` |

Not run: full `npm test`, Newman, lint, production build. Hosted Razorpay Test Mode was not used to pay, because those payments cannot match stand-in ids.

## Remaining limitations

- Product, gift, and Wardrobe Bag checkout now use the same local stand-in rule. See `docs/testing/COMPLETE_PAYMENT_SYSTEM_AUDIT.md`.
- Hosted Razorpay checkout is still correct for a real test or live key whose API base is `api.razorpay.com`. This machine’s QA stack is the stand-in.
- Six-month prepaid with no autopay is not what the server sells today. Changing that is a product and billing change, not this bug.
- QA user `qa-user-2@qa.test` now has an active membership from this verification.
