// Public store policies. The server seeds any missing legal_pages row from this file
// and falls back to it when a row has not been saved yet. Admin edits in the database win.
import { SITE } from '../site.config.js';

const phone = SITE.contact.phone || SITE.contact.whatsapp;
const studio = 'Vishrea Studio, Bengaluru, Karnataka, India';

export const POLICIES = {
  terms: {
    title: 'Terms and Conditions',
    description: 'The terms that apply when you shop with Vishrea Studio.',
    body: `These terms apply to purchases from ${studio} through ${SITE.url}.

The contract is formed when Razorpay captures your payment and the order status becomes paid. Until then, a checkout hold is only a reservation. Prices on the site are in Indian rupees and include GST. The amount you pay is calculated on our server from the catalogue, shipping, gift packing and any wardrobe credits. Amounts typed in the browser are not used.

Most pieces are one-of-one. A piece can sell out while you are paying. If we capture a payment for a piece we can no longer fulfil, we refund that payment in full.

Walkin Wardrobe membership costs ₹1,799 a month including GST. The first 2 months are charged together when you join, and you authorise UPI Autopay in the same checkout; from the third month ₹1,799 is debited monthly. If a debit fails we retry 3 times over 5 days, your credits are frozen meanwhile, and if every retry fails the membership pauses rather than being cancelled. You may pause for one month once every six months, with no charge and no new credits during the pause. You may cancel any time after the first 2 months; cancelling the mandate from your UPI app is treated as a cancellation. Credits apply only to eligible (non-Premium) pieces, expire 60 days after they are issued (you hold at most 8), and unused credits lapse on cancellation. Pieces redeemed with credits wait in your Wardrobe Bag; a shipment of 4 or more is free, a smaller one costs ₹99, and studio pickup is free. Gift memberships are prepaid for the chosen months, without autopay.

A member whose membership continues into its 6th consecutive paid month, whether prepaid or renewed, receives one free eligible piece in that month, and again every 6 consecutive paid months after that. A pause, or renewing after the short grace period once the paid period ends, starts the count again. A new customer who joins through a referral link receives the referral discount shown at checkout on a first 2-month membership; the person who referred her receives one free eligible piece once her first membership payment is confirmed.

You are responsible for the delivery details and phone number you submit. We may refuse an order that we cannot fulfil or that appears fraudulent.

These terms are governed by the laws of India. Courts in Bengaluru, Karnataka have jurisdiction, subject to any rights you have under consumer law.

Questions: WhatsApp or phone ${phone}${SITE.contact.email ? `, or ${SITE.contact.email}` : ''}.`,
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'How Vishrea Studio collects, uses and protects your personal information.',
    body: `${studio} collects only what we need to run the store.

Account and checkout: your name, email, phone number, delivery address, and order history. Sign-in uses a one-time code sent to your email. We do not store card numbers, UPI PINs, or netbanking passwords. Payments are processed by Razorpay, which receives the payment details under its own privacy policy.

We use this information to take payment, pack and ship or prepare a studio pickup, issue GST invoices, handle exchanges and refunds, and reply when you contact the studio. We do not sell personal information.

Order and invoice records are kept for accounting and tax. You can ask us what we hold about you, or ask us to correct it, on WhatsApp or phone ${phone}${SITE.contact.email ? ` or at ${SITE.contact.email}` : ''}.

The site is served over HTTPS. Session cookies are used to keep you signed in.`,
  },
  returns: {
    title: 'Refund, Return and Exchange Policy',
    description: 'How refunds, size exchanges and damage claims work at Vishrea Studio.',
    body: `Refunds, returns and exchanges for ${studio}.

Size exchange: request it from your order page within 7 days of delivery. Because most pieces are one-of-one, the same design may not exist in another size. The studio will tell you what is possible.

Damage: report it from your order page within 24 hours of delivery, with a photo if you can. We will replace the piece or refund it.

Refunds: if a payment is captured but the piece sold out before we could fulfil it, we refund the full amount to the original payment method through Razorpay. Closing the payment window before you pay does not charge you, and the pieces return to your bag. Membership cancellation forfeits unused wardrobe credits; it does not reverse months that were already paid unless we are required to.

Refunds are initiated by the studio and completed by Razorpay. Banks typically show them in a few working days after Razorpay processes them.

Contact ${phone}${SITE.contact.email ? ` or ${SITE.contact.email}` : ''} if a refund does not appear.`,
  },
  shipping: {
    title: 'Shipping and Delivery Policy',
    description: 'Delivery charges, dispatch times and studio pickup for Vishrea Studio.',
    body: `Shipping and delivery for ${studio}.

We deliver within India. Home delivery is ₹99. Studio pickup in Bengaluru is free and is chosen at checkout. Walkin Wardrobe members who redeem the required number of wardrobe credits on an order also receive free home delivery.

Orders are usually packed and dispatched within 48 hours. The courier tracking number is added to your order page when the parcel ships. Delivery time after dispatch depends on the courier and your PIN code.

We do not currently ship outside India. If a parcel is returned because the address or phone number was incomplete, contact the studio and we will arrange a reshipment or a refund of the merchandise, less the original shipping charge where the courier has already charged it.

Pickup orders are handed over at the Bengaluru studio once you receive confirmation that the order is ready. Bring the order details and a phone we can match to the order.

Questions: ${phone}${SITE.contact.email ? ` or ${SITE.contact.email}` : ''}.`,
  },
  'exchange-damage': {
    title: 'Exchange and Damage Policy',
    description: 'How exchanges and damage claims work at Vishrea Studio: 7 days for exchanges, 24 hours to report damage.',
    body: `Exchanges and damage claims for ${studio}.

Size exchanges can be requested from your order page within 7 days of delivery. Most pieces are one-of-one, so another size of the same piece may not exist. The studio will talk you through the options.

Report damage from your order page within 24 hours of delivery, ideally with a photo. We will arrange a replacement or a refund.

The full refund rules, including payments captured for a piece that sold out, are on the Refund, Return and Exchange Policy. Shipping charges and studio pickup are on the Shipping and Delivery Policy.

Contact ${phone}${SITE.contact.email ? ` or ${SITE.contact.email}` : ''}.`,
  },
};
