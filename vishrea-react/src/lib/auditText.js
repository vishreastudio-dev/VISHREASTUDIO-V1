// Turns raw audit_logs rows into plain sentences for the admin Audit Log.
// Unknown actions fall back to a readable version of the action name, so nothing is ever hidden.

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const paise = (v) => inr(Number(v || 0) / 100);
const words = (s) => String(s ?? '').replace(/_/g, ' ').trim();
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const STATUS = {
  pending_payment: 'awaiting payment', processing: 'processing', packed: 'packed', dispatched: 'dispatched', delivered: 'delivered',
  cancelled: 'cancelled', refund_required: 'refund needed', refunded: 'refunded', payment_failed: 'payment failed', inactive: 'inactive',
  active: 'active', paused: 'paused', expired: 'expired', requested: 'requested', review: 'under review', approved: 'approved',
  rejected: 'rejected', completed: 'completed', pending: 'pending', processed: 'processed', invoiced: 'invoiced',
};
const status = (s) => `“${STATUS[s] || words(s)}”`;
const move = (d, noun) => (d.from && d.to && d.from !== d.to ? `Moved the ${noun} from ${status(d.from)} to ${status(d.to)}` : `Updated the ${noun}`);

const ACTIONS = {
  admin_login: () => 'Signed in to the admin panel',
  login: () => 'Signed in',
  logout: () => 'Signed out',
  customer_data_deleted: () => 'Deleted their personal data',

  admin_added: (d) => `Gave ${d.email} admin access as ${d.role === 'owner' ? 'an owner' : 'an admin'}${d.existing_account ? ' (existing customer account)' : ''}`,
  admin_updated: (d) => {
    const parts = [];
    if (d.role) parts.push(`role ${d.role.before} → ${d.role.after}`);
    if (d.active) parts.push(d.active.after ? 'account re-enabled' : 'account disabled');
    if (d.name) parts.push(`name changed to “${d.name.after || '—'}”`);
    return `Changed administrator ${d.email}: ${parts.join(', ') || 'no changes'}`;
  },
  admin_removed: (d) => `Removed admin access for ${d.email}`,

  checkout_started: (d) => `Started checkout: ${plural(d.lines, 'piece')}, ${inr(d.total)}${d.credits_used ? `, ${plural(d.credits_used, 'credit')} used` : ''}`,
  order_paid: (d) => `Payment of ${paise(d.amount_paise)} received for the order`,
  update_order: (d) => {
    const ship = [d.courier_partner && `via ${d.courier_partner}`, d.tracking_number && `tracking ${d.tracking_number}`].filter(Boolean).join(', ');
    return `${move(d, 'order')}${ship ? ` (${ship})` : ''}`;
  },
  store_sale: (d) => `Recorded an in-store sale of ${inr(d.total)}${d.mode ? ` paid by ${words(d.mode).toUpperCase() === 'UPI' ? 'UPI' : words(d.mode)}` : ''}`,
  order_refund_required: (d) => `Flagged the order for a refund${d.reason ? `: ${words(d.reason)}` : ''}`,
  order_auto_refunded: () => 'Refunded the order automatically',
  duplicate_payment_refunded: (d) => `Refunded a duplicate payment of ${paise(d.amount_paise)}`,
  payment_gateway_mismatch: (d) => `Payment did not match the order${d.reason ? `: ${words(d.reason)}` : ''}`,
  payment_signature_invalid: () => 'A payment confirmation failed the security check and was rejected',

  membership_checkout_started: (d) => `Started paying for a ${d.months}-month membership: ${inr(d.amount)}${Number(d.discount) ? ` after a ${inr(d.discount)} discount` : ''}`,
  membership_paid: (d) => `Payment received for a ${d.months}-month membership${d.credits_per_month ? ` (${plural(d.credits_per_month, 'credit')} a month)` : ''}${Number(d.discount) ? `, ${inr(d.discount)} discount` : ''}`,
  membership_cancelled: (d) => `Cancelled the membership${d.reason ? `: ${words(d.reason)}` : ''}${d.forfeited ? `, ${plural(d.forfeited, 'credit')} forfeited` : ''}`,
  membership_paused: () => 'Paused the membership',
  membership_resumed: (d) => `Resumed the membership${d.early ? ' early' : ''}`,
  membership_expired: () => 'The membership expired',
  membership_paused_payment_failed: () => 'The membership was paused because a payment failed',
  membership_refunded: () => 'The membership payment was refunded',
  membership_partial_refund: (d) => `Part of the membership payment was refunded (${paise(d.amount_paise)})`,
  membership_signature_invalid: () => 'A membership payment confirmation failed the security check',
  membership_charge_after_cancel: (d) => `Money was taken ${d.reason === 'charged_on_replaced_mandate' ? 'on a replaced autopay mandate' : 'after the membership was cancelled'}; it needs a refund`,
  update_membership: (d) => move(d, 'membership'),
  adjust_credits: (d) => `${Number(d.delta) > 0 ? 'Added' : 'Removed'} ${plural(Math.abs(Number(d.delta)), 'credit')}, new balance ${d.balance}${d.reason ? ` (“${d.reason}”)` : ''}`,
  credits_holding_limit: (d) => `${plural(d.lapsed, 'credit')} lapsed for going over the ${d.limit}-credit limit`,

  create_product: (d) => `Added the piece “${d.name}”${d.variants ? ` with ${plural(d.variants, 'size')}` : ''}`,
  update_product: (d) => `Edited the piece “${d.name}”`,
  product_visibility: (d) => (d.is_active ? 'Published the piece to the store' : 'Hid the piece from the store'),
  inventory_adjusted: (d) => `Changed stock${d.sku ? ` for ${d.sku}` : ''} from ${d.before} to ${d.after}${d.reason ? ` (“${d.reason}”)` : ''}`,
  archive_product: () => 'Archived the piece (it has order history)',
  delete_product: () => 'Deleted the piece',
  save_category: (d) => `Saved the category “${d.name}”`,
  delete_category: () => 'Deleted the category',

  create_courier: (d) => `Added the courier “${d.name}”`,
  update_courier: (d) => `Edited the courier “${d.name}”`,
  activate_courier: (d) => `Activated the courier “${d.name}”`,
  deactivate_courier: (d) => `Deactivated the courier “${d.name}”`,
  delete_courier: (d) => `Deleted the courier “${d.name}”`,

  exchange_requested: (d) => `Asked for ${d.claim_type === 'damage' ? 'a damage claim' : 'an exchange'}${d.order_id ? ` on order #${String(d.order_id).slice(0, 8).toUpperCase()}` : ''}`,
  update_exchange: (d) => move(d, 'exchange request'),
  gift_enquiry_created: (d) => `Sent a gift enquiry${d.months ? ` for a ${d.months}-month membership` : ''}`,
  update_gift_enquiry: (d) => move(d, 'gift enquiry'),
  gift_purchase_started: (d) => `Started buying a ${d.months}-month gift membership: ${inr(d.amount)}`,
  gift_purchase_paid: () => 'Payment received for a gift membership',
  gift_token_issued: () => 'Issued a gift membership code',
  gift_token_revoked: () => 'Revoked an unused gift code',
  gift_redeemed: (d) => `Redeemed a ${d.months}-month gift membership`,

  reward_issued: (d) => `Earned a free-piece reward${d.kind === 'six_month_milestone' ? ' for 6 paid months in a row' : ''}`,
  reward_void: (d) => `Voided a free-piece reward${d.reason ? ` (“${d.reason}”)` : ''}`,
  reward_clear_flag: (d) => `Cleared the flag on a free-piece reward${d.reason ? ` (“${d.reason}”)` : ''}`,
  reward_revoked: () => 'Revoked an unused free-piece reward because its payment was refunded',
  reward_flagged: () => 'Flagged a used free-piece reward because its payment was refunded',
  referral_attributed: () => 'Joined using a referral code',
  referral_qualified: () => 'A referral qualified and the referrer earned a free piece',

  bag_ship_requested: (d) => `Asked to ship the bag: ${plural(d.pieces, 'piece')}, ${inr(d.fee)} shipping`,
  bag_shipping_paid: (d) => `Payment received for bag shipping${d.orders_moved ? ` (${plural(d.orders_moved, 'order')} moved to processing)` : ''}`,
  bag_shipping_refund_required: () => 'Bag shipping was paid too late and needs a refund',

  carousel_slide_created: (d) => `Added a homepage banner slide${d.heading ? ` “${d.heading}”` : ''} as a draft`,
  carousel_slide_updated: (d) => `Saved changes to the homepage slide${d.heading ? ` “${d.heading}”` : ''}`,
  carousel_slide_published: (d) => `Published the homepage slide${d.heading ? ` “${d.heading}”` : ''}`,
  carousel_slide_unpublished: (d) => `Took the homepage slide${d.heading ? ` “${d.heading}”` : ''} off the homepage`,
  carousel_slide_activated: (d) => `Activated the homepage slide${d.heading ? ` “${d.heading}”` : ''}`,
  carousel_slide_deactivated: (d) => `Deactivated the homepage slide${d.heading ? ` “${d.heading}”` : ''}`,
  carousel_slide_duplicated: (d) => `Duplicated the homepage slide${d.heading ? ` “${d.heading}”` : ''}`,
  carousel_slide_deleted: (d) => `Deleted the homepage slide${d.heading ? ` “${d.heading}”` : ''}${d.was_published ? ' (it was published)' : ''}`,
  carousel_slides_reordered: () => 'Changed the order of the homepage slides',
  carousel_settings_updated: (d) => `Changed homepage carousel settings: ${Object.keys(d).map(words).join(', ')}`,
  update_settings: (d) => `Changed settings: ${Object.keys(d).map(words).join(', ')}`,
  save_loyalty_rule: (d) => `Saved the offer “${d.name}”${d.active === false ? ' (inactive)' : ''}`,
  create_drop: (d) => `Created the drop “${d.name}”`,
  create_sourcing_batch: (d) => `Logged a sourcing batch from ${d.supplier || 'a supplier'}`,
  piece_request_created: () => 'Asked for a piece to be sourced',
  update_piece_request: (d) => `Updated a piece request${d.status ? ` to ${status(d.status)}` : ''}`,
  delete_instagram: () => 'Deleted an Instagram feature',
  delete_video: () => 'Deleted a customer video',
};

const ACTORS = {
  system: 'System (automatic)',
  razorpay_webhook: 'Razorpay (payment gateway)',
  guest: 'Website visitor',
};

const ENTITIES = {
  order: 'Order', membership: 'Membership', membership_payment: 'Membership payment', product: 'Piece', product_variant: 'Piece size',
  category: 'Category', courier: 'Courier', profile: 'Account', settings: 'Settings', content: 'Content', gift_enquiry: 'Gift enquiry',
  gift_membership: 'Gift code', reward_entitlement: 'Free-piece reward', referral: 'Referral', exchange: 'Exchange', bag_shipment: 'Bag shipment',
  payment_event: 'Payment event', loyalty_rule: 'Offer', carousel_slide: 'Homepage slide', carousel: 'Homepage carousel', drop: 'Drop', sourcing: 'Sourcing batch', piece_request: 'Piece request',
};

const DETAIL_LABELS = {
  payment_id: 'Payment ID', amount_paise: 'Amount', tracking_number: 'Tracking number', courier_partner: 'Courier', ip: 'IP address',
  subscription_id: 'Autopay mandate', credits_used: 'Credits used', lines: 'Pieces', from: 'From', to: 'To', source: 'Confirmed by',
};
const HIDDEN_DETAILS = new Set(['courier_id', 'product_id', 'reward_ids', 'membership_payment_id', 'enquiry_id', 'referrer', 'held_by_order', 'order', 'source_id']);

function detailValue(key, value) {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'amount_paise') return paise(value);
  if (['total', 'amount', 'discount', 'fee'].includes(key)) return inr(value);
  if (key === 'source') return value === 'webhook' ? 'Razorpay notification' : value === 'verify' ? 'Checkout confirmation' : words(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'from' || key === 'to') return STATUS[value] || words(value);
  if (value && typeof value === 'object') {
    if ('before' in value || 'after' in value) return `${JSON.stringify(value.before ?? '—')} → ${JSON.stringify(value.after ?? '—')}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/** { who, whoNote, what, about, aboutNote, details: [[label, value]] } for one audit row. */
export function describeAudit(x) {
  const d = x.details && typeof x.details === 'object' ? x.details : {};
  const action = String(x.action || '');

  let what;
  if (ACTIONS[action]) {
    try {
      what = ACTIONS[action](d);
    } catch {
      what = null;
    }
  }
  if (!what && action.startsWith('content_')) what = `Saved ${words(action.slice(8))} content${d.title ? ` “${d.title}”` : ''}`;
  if (!what && action.startsWith('webhook_')) what = `Razorpay sent “${words(action.slice(8)).replace(/\./g, ' ')}”${d.outcome ? `: ${words(d.outcome)}` : ''}`;
  if (!what) what = sentence(words(action));

  const actorId = x.auth_user_id;
  const who = ACTORS[actorId] || x.actor_name || x.actor_email || (actorId ? 'Deleted or unknown account' : 'System (automatic)');
  const whoNote = ACTORS[actorId] ? '' : [x.actor_name && x.actor_email ? x.actor_email : '', x.actor_is_admin ? 'Admin' : actorId ? 'Customer' : ''].filter(Boolean).join(' · ');

  const type = x.entity_type;
  const id = x.entity_id ? String(x.entity_id) : '';
  const ref = /^[0-9a-f-]{36}$/i.test(id) ? `#${id.slice(0, 8).toUpperCase()}` : '';
  const showRef = ref && (type === 'order' || !x.entity_label);
  const about = type ? `${ENTITIES[type] || sentence(words(type))}${showRef ? ` ${ref}` : ''}` : '—';
  const aboutNote = !x.entity_label ? '' : type === 'order' || type === 'membership' ? `for ${x.entity_label}` : x.entity_label;

  const details = Object.entries(d)
    .filter(([k, v]) => !HIDDEN_DETAILS.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [DETAIL_LABELS[k] || sentence(words(k)), detailValue(k, v)])
    .filter(([, v]) => v !== null);

  return { who, whoNote, what, about, aboutNote, details };
}
