# Complete payment system audit

Date: 2026-11-11. Local QA only. This does not make the payment system production-ready.

## Flows

| Flow | Start | Verify | Local stand-in |
|---|---|---|---|
| Product order | `POST /api/checkout` | `POST /api/payment-verify` | `checkout_mode: local`, then `POST /api/checkout` `complete_local`, then the same verify |
| Membership | `POST /api/membership` `start_checkout` | `activate_paid` or `complete_local_checkout` | Inline sheet. Does not load `checkout.razorpay.com` |
| Gift | `POST /api/gifting` `purchase` | `confirm_payment` | `complete_local` returns a signature; the page then calls `confirm_payment` |
| Wardrobe Bag | `POST /api/wardrobe` `ship_bag` | `confirm_bag_payment` | Same pattern as gifts |

`checkout_mode` is set only when `RAZORPAY_API_BASE` is `127.0.0.1` or `localhost` (`lib/config.js`). The browser does not choose the mode. `complete_local` and `complete_local_checkout` return 404 when the API base is Razorpay’s host.

Hosted `checkout.razorpay.com` is still used when the server is on real test or live keys.

## Membership rules

Implemented and covered by existing tests:

- 2 months up front, ₹3,598, then UPI Autopay at ₹1,799.
- 4 credits when the paid month starts. 60-day expiry is unchanged.
- `months: 6` is rejected (400). `calculateMembershipPrice` can price ₹10,794, but that plan is not on sale.
- The free piece is for the 6th consecutive paid month of this autopay model, not a separate 6-month prepay.
- Gift and admin months are not the autopay charge path that issues that reward.

Not implemented, and not changed in this pass:

- No autopay.
- A 6-month prepaid product at ₹10,794.
- Two-month renewals that must not count toward a 6-month reward under a prepaid-only model.

Stopping here is deliberate. The database already has subscription and mandate columns, and tests assert the autopay lifecycle. Switching it off would change how current mandates behave. No customer subscription was cancelled or edited.

## What was fixed

Local stand-in ids for product, gift, and bag checkout are no longer sent to Razorpay’s hosted script. The stand-in payment is created with `POST /__pay`, signed with the server secret, and checked by the existing verify functions. A failed outcome does not return a signature. Another customer’s id is rejected. Kiro’s `request_id` on payment-verify 409 responses was kept.

## Tests this pass

See the session report. Full `npm test`, Newman, lint, and production build are recorded there only if they finished. Hosted Razorpay test mode was not used.

## Still required before production

Live Razorpay keys and webhook, a real low-value payment and refund, and the owner’s written choice if membership should drop autopay.
