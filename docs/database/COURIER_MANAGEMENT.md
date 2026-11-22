# Courier Management

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Admin screen | `/admin/couriers` (Admin → Couriers) |
| Code | `lib/couriers.js`, `api/admin/ops.js` (sections `couriers`, `courier`, `courier_status`, `order_shipments`, `order`), `vishrea-react/src/pages/AdminExtras.jsx` (`CouriersSection`), `Admin.jsx` (dispatch modal), `components/OrderTracker.jsx` |
| Migration | `migrations/021_courier_management.sql` — **must be applied before deploying this code** |
| Tests | `test/couriers-inventory.test.js`, `test/couriers-unit.test.js`, `test/migration-rehearsal.test.js`, existing journey test in `test/platform.test.js` |

## 1. What the owner can do (no code change or deployment)

| Action | How | Rules |
|---|---|---|
| Add a courier | Couriers → **Add courier** | Name required (2–80 characters, unique ignoring case/spaces) |
| Edit | **Edit** | Any field; partial updates keep the others |
| Search | Search box | Name, contact person or service area |
| Activate / deactivate | **Activate / Deactivate** | Inactive couriers disappear from the dispatch list; orders already sent with them keep every detail |
| Delete | **Delete** (shown only when unused) | Only if no order or shipment record has ever used the courier; otherwise 409 "Deactivate it instead" |

Fields: company name, contact person, contact number, website (`https://`), tracking URL template, service description, supported service areas, "AWB required to dispatch", "Studio pickup", active, display order; created/updated dates are kept automatically. Every change is written to the audit log.

### Tracking URL template

- Put `{tracking}` where the AWB goes, e.g. `https://www.delhivery.com/track/package/{tracking}`.
- Without `{tracking}` the URL is used as-is (couriers with a tracking page but no deep link, e.g. India Post).
- Empty = no link; the customer sees the AWB number only.
- Must be `https://`; the AWB may only appear in the path or query (not the domain). The AWB is URL-encoded.
- No courier API is assumed and no tracking status is invented: the customer sees the studio's own status (Packed, Dispatched, Delivered) plus the courier's link.

## 2. Dispatch

1. Orders → **dispatched** on a paid order opens the dispatch dialog.
2. The dropdown lists **active** couriers (from the database).
3. Enter the AWB; it is required when the courier has "AWB required" (seeded: Delhivery, BlueDart, DTDC, Shiprocket, India Post).
4. The dialog previews the customer's link; it shows any previous shipment updates for the order.
5. Save → the order stores `courier_id`, the courier's name at that moment (`courier_partner`), the AWB (`tracking_number`) and the generated link (`tracking_url`); status becomes dispatched; the dispatch e-mail uses the stored link.

API: `POST /api/admin/ops?section=order` `{ id, status: 'dispatched', courier_id, tracking_number }`. Older clients may still send `courier_partner` (the courier name); unknown names are refused (400), inactive couriers cannot be newly chosen (422), a tracked courier without an AWB is refused (422).

## 3. History preservation

- The link and name are **snapshots**: later edits to a courier's name or template, or deactivating it, do not change orders already dispatched (tested).
- `order_shipment_events` records every status/courier/AWB change made by the studio (status, courier id and name, AWB, link, admin user, time); `GET /api/admin/ops?section=order_shipments&id=<order>` returns it.
- `orders.courier_id` references `couriers` with `ON DELETE RESTRICT`.

## 4. Customer view

The order page tracker shows "Handed to <courier> · Tracking <AWB>" and **Track with <courier> →** using the stored `tracking_url` (rendered only if it is `https://`). Studio-pickup couriers show the pickup wording instead of a courier step.

## 5. Migration 021 and existing data

- Creates `couriers` and seeds the seven couriers previously hard-coded in the application, with the same tracking pages.
- Links existing orders to those rows by name and fills `tracking_url` where the AWB needs no encoding; nothing else on existing orders changes.
- Drops `orders_courier_partner_valid`, the check that restricted `courier_partner` to the seven fixed names (otherwise a new courier could not be stored).
- Rehearsed on a production-shaped schema; re-running is a no-op.

**Deployment order:** apply `021` first, then deploy the code. The current code reads the new columns; against a database without `021`, order pages and dispatch return errors.
