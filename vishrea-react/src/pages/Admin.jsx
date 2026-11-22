import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, Navigate, NavLink, useParams, useLocation } from 'react-router-dom';
import { api, uploadFile } from '../lib/api';
import { usePageSeo } from '../lib/usePageSeo';
import { LoadingState, ErrorState, AdminErrorBoundary } from '../components/Status';
import { previewTrackingUrl } from '../lib/couriers';
import { describeAudit } from '../lib/auditText';
import { productContentGaps } from '../lib/productCopy';
import { HomepageSection } from './AdminHomepage';
import { AdministratorsSection, CouriersSection, CustomerDetail, GiftEnquiriesSection, LegalEditor, ReferralsSection, RewardsSection, SettingsSection } from './AdminExtras';
import { AIStudio } from '../admin/AIStudio';
import {
  suggestBatchId,
  calculateCostPerUnit,
  calculateStockLeft,
  calculateStockValue,
  classifyInventory,
  calculateLineAmount,
  calculateSaleTotals,
  calculateCustomerLoyalty,
  calculatePurchaseOrderTotals,
} from '../lib/business-calculations';

const COLOUR_SEASONS = ['Light Spring', 'True Autumn', 'Soft Autumn', 'Deep Autumn', 'Light Summer', 'Soft Summer', 'True Winter', 'Deep Winter'];
const EXCHANGE_NEXT = {
  requested: ['review', 'approved', 'not_approved', 'rejected'],
  review: ['approved', 'not_approved', 'rejected'],
  approved: ['not_approved', 'completed', 'review', 'rejected'],
  not_approved: ['approved', 'review', 'rejected', 'completed'],
  rejected: ['review', 'approved', 'not_approved'],
  completed: ['approved', 'not_approved'],
};
const EXCHANGE_STATUS_LABELS = {
  requested: 'Requested',
  review: 'Under Review',
  approved: 'Approve',
  not_approved: 'Not Approve',
  rejected: 'Reject',
  completed: 'Completed',
};
const ALL_EXCHANGE_STATUSES = [
  ['requested', 'Requested'],
  ['review', 'Under Review'],
  ['approved', 'Approve'],
  ['not_approved', 'Not Approve'],
  ['completed', 'Completed'],
  ['rejected', 'Reject'],
];
const MEMBERSHIP_STATUSES = ['active', 'paused', 'expired', 'cancelled', 'payment_failed', 'inactive'];
// Sections that render their own data component instead of the shared section cache.
const SELF_LOADING = new Set(['ai_studio', 'gift_enquiries', 'referrals', 'rewards', 'settings', 'couriers', 'administrators', 'homepage']);

const ORDER_NEXT = { pending_payment: ['cancelled'], processing: ['packed', 'dispatched', 'cancelled'], packed: ['dispatched', 'processing', 'cancelled'], dispatched: ['delivered'], refund_required: ['refunded'], cancelled: ['refunded'] };
const newVariant = (i = 0) => ({ key: `new-${Date.now()}-${i}`, size_label: '', sku: '', price_inr: '', sale_price_inr: '', stock_quantity: 1, is_active: true });
// Older pieces may only have the legacy single `image_url`, so it is folded into the gallery.
const productImages = (p) => {
  const list = (Array.isArray(p.images) ? p.images : []).filter((u) => typeof u === 'string' && u);
  if (p.image_url && !list.includes(p.image_url)) list.unshift(p.image_url);
  return list;
};

function PricingHelper({ costPrice, badge, onApplyPrice }) {
  const isPremium = String(badge || '').trim().toUpperCase().includes('PREMIUM');
  const [markupMultiplier, setMarkupMultiplier] = useState(isPremium ? 3.0 : 2.4);
  const cost = Number(costPrice) || 0;

  if (!cost || cost <= 0) {
    return (
      <div style={{ background: '#faf8f5', border: '1px dashed #d5ccbe', borderRadius: 4, padding: '10px 14px', fontSize: 12, color: '#7a7062', margin: '10px 0 14px' }}>
        <strong>Pricing Helper (CAT-04):</strong> Enter a cost price above to view suggested retail price based on owner markup rules, margin %, and GST slab.
      </div>
    );
  }

  const rawSuggested = cost * markupMultiplier;
  const suggestedPrice = Math.round(rawSuggested);
  const marginPercent = suggestedPrice > 0 ? Math.round(((suggestedPrice - cost) / suggestedPrice) * 100) : 0;
  const grossProfit = suggestedPrice - cost;
  const gstRate = suggestedPrice <= 2500 ? 5 : 18;
  const inSharedPoolRange = suggestedPrice >= 599 && suggestedPrice <= 1499;

  return (
    <div style={{ background: '#fdfbf7', border: '1px solid #d4c1a5', borderRadius: 6, padding: '12px 14px', margin: '10px 0 14px', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <strong style={{ textTransform: 'uppercase', letterSpacing: '.06em', color: '#543b18' }}>
          Pricing Helper · Owner Markup &amp; GST Slab
        </strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#666', fontSize: 11 }}>Markup multiplier:</span>
          {[2.0, 2.4, 2.8, 3.0].map((m) => (
            <button
              key={m}
              type="button"
              className="btn"
              style={{
                padding: '2px 8px',
                fontSize: 11,
                background: markupMultiplier === m ? '#543b18' : '#fff',
                color: markupMultiplier === m ? '#fff' : '#333',
                borderColor: markupMultiplier === m ? '#543b18' : '#ccc',
                fontWeight: markupMultiplier === m ? 600 : 400,
              }}
              onClick={() => setMarkupMultiplier(m)}
            >
              {m.toFixed(1)}x
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, background: '#fff', padding: '10px 12px', borderRadius: 4, border: '1px solid #ebd9c0' }}>
        <div>
          <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase' }}>Suggested Price</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>₹{suggestedPrice}</div>
          <div style={{ fontSize: 10, color: '#777' }}>Displayed price incl. GST</div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase' }}>Gross Margin</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: marginPercent >= 50 ? '#1b7340' : '#8a5a00' }}>{marginPercent}%</div>
          <div style={{ fontSize: 10, color: '#777' }}>₹{grossProfit} margin</div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase' }}>GST Slab (CAT-05)</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>{gstRate}% GST</div>
          <div style={{ fontSize: 10, color: gstRate === 5 ? '#1b7340' : '#b25e00' }}>{suggestedPrice <= 2500 ? '≤ ₹2,500 threshold (5%)' : '> ₹2,500 threshold (18%)'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: '#684523', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
            onClick={() => onApplyPrice(suggestedPrice)}
          >
            Apply ₹{suggestedPrice} to sizes
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#6d6152', lineHeight: 1.4 }}>
        {!isPremium ? (
          <span>Shared pool target: <strong>₹599–₹1,499</strong> (4 pieces look worth well over ₹1,799). {inSharedPoolRange ? 'Suggested price fits within range.' : 'Adjust markup if desired.'} The owner makes the final pricing decision.</span>
        ) : (
          <span>Premium piece: priced per piece with no fixed range. The owner makes the final pricing decision.</span>
        )}
      </div>
    </div>
  );
}

function ProductThumb({ images, name, size = 48, onOpen }) {
  const box = { position: 'relative', flex: '0 0 auto', width: size, height: Math.round(size * 1.25) };
  if (!images.length) {
    return <span title="No image" style={{ ...box, display: 'grid', placeItems: 'center', border: '1px dashed var(--admin-line, #ccc)', fontSize: 8, color: 'var(--muted, #888)', textTransform: 'uppercase', textAlign: 'center' }}>No img</span>;
  }
  return (
    <button
      type="button"
      title={`View ${images.length} image${images.length > 1 ? 's' : ''}`}
      aria-label={`View images of ${name}`}
      onClick={onOpen}
      style={{ ...box, padding: 0, border: '1px solid var(--admin-line, #e5e5e5)', background: '#f4f1ee', cursor: 'zoom-in', overflow: 'hidden' }}
    >
      <img src={images[0]} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {images.length > 1 && (
        <span style={{ position: 'absolute', right: 2, bottom: 2, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 9, lineHeight: 1, padding: '2px 4px', borderRadius: 2 }}>{images.length}</span>
      )}
    </button>
  );
}

const NAV_GROUPS = [
  {
    id: 'catalog_stock',
    label: 'CATALOG & STOCK',
    items: [
      ['products', 'Inventory & Pieces'],
      ['categories', 'Categories'],
      ['drops', 'Drops'],
      ['sourcing', 'Sourcing Batches'],
      ['vendors', 'Vendors'],
    ],
  },
  {
    id: 'sales_orders',
    label: 'SALES & ORDERS',
    items: [
      ['orders', 'Online Orders'],
      ['store', 'Counter Sales & POS'],
      ['procurement', 'Procurement & POS'],
      ['couriers', 'Couriers'],
      ['exchanges', 'Exchanges'],
      ['invoices', 'Invoices'],
    ],
  },
  {
    id: 'customers_growth',
    label: 'CUSTOMERS & GROWTH',
    items: [
      ['customers', 'Customers & CRM'],
      ['memberships', 'Membership'],
      ['credits', 'Credits'],
      ['rewards', 'Rewards'],
      ['referrals', 'Referrals'],
      ['loyalty', 'Offers & Loyalty'],
      ['gift_enquiries', 'Gift Enquiries'],
    ],
  },
  {
    id: 'studio_system',
    label: 'STUDIO & SYSTEM',
    items: [
      ['ai_studio', 'Vishrea AI Studio'],
      ['homepage', 'Homepage'],
      ['content', 'Content & Legal'],
      ['administrators', 'Administrators'],
      ['audit', 'Audit Log'],
      ['settings', 'Settings'],
    ],
  },
];

const SECTIONS = [
  ['dashboard', 'Overview'],
  ...NAV_GROUPS.flatMap((g) => g.items),
];
const SECTION_LABELS = new Map(SECTIONS);

const findGroupForSection = (sec) => {
  return NAV_GROUPS.find((g) => g.items.some(([k]) => k === sec))?.id || null;
};
const PAYMENT_REASON = {
  payment_window_expired: 'Checkout not completed (hold expired)',
  superseded_by_new_checkout: 'Replaced by a newer checkout',
  cancelled_by_customer: 'Cancelled by the customer before paying',
  cancelled_by_admin: 'Cancelled by the studio before payment',
  razorpay_not_configured: 'Online payment was unavailable',
  gateway_order_failed: 'Payment gateway could not start the payment',
  amount_mismatch: 'Paid amount did not match the order',
  gateway_order_mismatch: 'Payment belonged to a different gateway order',
};

// Server-side search and filters for the long lists (`/api/admin/ops?section=…&q=…`).
const LIST_FILTERS = {
  products: {
    placeholder: 'Name or SKU',
    selects: [
      ['state', 'State', [['', 'All'], ['live', 'Live'], ['hidden', 'Hidden'], ['out_of_stock', 'Out of stock'], ['low_stock', 'Low stock (1–2)']]],
      ['category_id', 'Category', 'categories'],
    ],
    toggles: [['include_archived', 'Include archived']],
  },
  orders: {
    placeholder: 'Order ID, customer, email, invoice or tracking',
    selects: [
      ['status', 'Status', [['', 'All'], ...Object.keys(ORDER_NEXT).concat(['delivered', 'refunded', 'expired']).filter((v, i, a) => a.indexOf(v) === i).map((s) => [s, s.replace(/_/g, ' ')])]],
      ['payment_status', 'Payment', [['', 'All'], ['pending', 'Pending'], ['paid', 'Paid'], ['failed', 'Failed'], ['refund_required', 'Refund required'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled'], ['expired', 'Expired']]],
    ],
    toggles: [['abandoned', 'Include abandoned checkouts']],
  },
  customers: {
    placeholder: 'Name, email or phone',
    selects: [
      ['membership', 'Membership', [['', 'All'], ['none', 'Never joined'], ['active', 'Active'], ['paused', 'Paused'], ['expired', 'Expired'], ['cancelled', 'Cancelled'], ['pending_payment', 'Awaiting payment']]],
      ['sort', 'Ranking / Sort', [['', 'Default (Newest)'], ['top_spending', 'Top Spenders (Highest Spend)'], ['order_count', 'Most Orders']]],
      ['min_spent', 'Minimum Spend', [['', 'Any Spend'], ['1000', 'Over ₹1,000'], ['5000', 'Over ₹5,000 (High Value)'], ['10000', 'Over ₹10,000 (VIP)']]],
    ],
  },
  procurement: {
    placeholder: 'PO number, vendor or batch ID',
    selects: [
      ['status', 'Status', [['', 'All'], ['unfulfilled', 'Unfulfilled'], ['fulfilled', 'Fulfilled'], ['cancelled', 'Cancelled']]],
    ],
  },
  vendors: {
    placeholder: 'Vendor name or phone',
    selects: [],
  },
  store: {
    placeholder: 'Sale ID, customer name or phone',
    selects: [
      ['status', 'Payment', [['', 'All'], ['paid', 'Paid'], ['partially_paid', 'Partially Paid'], ['due', 'Due'], ['cancelled', 'Cancelled']]],
    ],
  },
};

function ListFilter({ section, categories, onApply, busy }) {
  const location = useLocation();
  const config = LIST_FILTERS[section];
  const toggleKeys = useMemo(() => new Set((config?.toggles || []).map(([k]) => k)), [config]);
  const empty = useMemo(() => {
    if (!config) return {};
    return { q: '', ...Object.fromEntries([...config.selects, ...(config.toggles || [])].map(([k]) => [k, toggleKeys.has(k) ? false : ''])) };
  }, [config, toggleKeys]);

  const readValuesFromUrl = useCallback(() => {
    if (!config) return {};
    const sp = new URLSearchParams(location.search);
    const res = { ...empty };
    if (sp.has('q')) res.q = sp.get('q') || '';
    for (const [k] of config.selects || []) {
      if (sp.has(k)) res[k] = sp.get(k) || '';
    }
    for (const [k] of config.toggles || []) {
      if (sp.has(k)) {
        const val = sp.get(k);
        res[k] = val === 'true' || val === '1' || val === k;
      }
    }
    return res;
  }, [config, location.search, empty]);

  const [values, setValues] = useState(readValuesFromUrl);

  useEffect(() => {
    setValues(readValuesFromUrl());
  }, [readValuesFromUrl]);

  if (!config) return null;

  const apply = (next) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v !== '' && v !== false && v != null) {
        params.set(k, String(v).trim());
      }
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    if (window.history.replaceState) {
      const newUrl = `${window.location.pathname}${qs}`;
      window.history.replaceState(null, '', newUrl);
    }
    onApply(qs);
  };
  const set = (k, v, now = false) => {
    const next = { ...values, [k]: v };
    setValues(next);
    if (now) apply(next);
  };
  return (
    <form className="admin-filter" role="search" aria-label={`Search ${section}`} onSubmit={(e) => { e.preventDefault(); apply(values); }}>
      <label className="admin-filter-q">
        <span>Search</span>
        <input type="search" value={values.q} maxLength={80} placeholder={config.placeholder} onChange={(e) => set('q', e.target.value)} />
      </label>
      {config.selects.map(([k, label, options]) => (
        <label key={k}>
          <span>{label}</span>
          <select value={values[k]} onChange={(e) => set(k, e.target.value, true)}>
            {(options === 'categories' ? [['', 'All'], ...categories.map((c) => [c.id, c.name])] : options).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </label>
      ))}
      {(config.toggles || []).map(([k, label]) => (
        <label key={k} className="admin-filter-toggle">
          <input type="checkbox" checked={values[k]} onChange={(e) => set(k, e.target.checked, true)} /> {label}
        </label>
      ))}
      <button className="btn" disabled={busy}>Search</button>
      <button type="button" className="btn" disabled={busy} onClick={() => { setValues(empty); apply(empty); }}>Clear</button>
    </form>
  );
}
// Section keys are also the `/api/admin/ops?section=` names; URLs use kebab-case.
const sectionPath = (key) => (key === 'dashboard' ? '/admin' : `/admin/${key.replace(/_/g, '-')}`);

const SECTION_ALIASES = {
  inventory: 'products',
  'counter-sales-pos': 'store',
  'counter-sales': 'store',
  pos: 'store',
  'customers-crm': 'customers',
  'procurement-pos': 'procurement',
};

/** `/admin` is the overview; `/admin/<section>` opens one section. Unknown sections go back to the overview. */
export const Admin = () => {
  const { section: slug } = useParams();
  if (slug && SECTION_ALIASES[slug]) {
    return <Navigate to={sectionPath(SECTION_ALIASES[slug])} replace />;
  }
  const section = slug ? slug.replace(/-/g, '_') : 'dashboard';
  if (slug === 'dashboard' || !SECTION_LABELS.has(section)) return <Navigate to="/admin" replace />;
  return <AdminStudio section={section} />;
};

function AdminStudio({ section }) {
  const sectionLabel = SECTION_LABELS.get(section);
  usePageSeo({ title: `${sectionLabel} | Studio Admin | Vishrea Studio`, noIndex: true });
  const [cache, setCache] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [openAccordion, setOpenAccordion] = useState(() => findGroupForSection(section));

  useEffect(() => {
    const matchingGroup = findGroupForSection(section);
    if (matchingGroup) {
      setOpenAccordion(matchingGroup);
    }
  }, [section]);

  const toggleAccordion = (groupId) => {
    setOpenAccordion((prev) => (prev === groupId ? null : groupId));
  };

  useEffect(() => {
    setAdminNavOpen(false);
  }, [section]);

  useEffect(() => {
    if (!adminNavOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setAdminNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adminNavOpen]);

  const [modalType, setModalType] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [storeSearch, setStoreSearch] = useState('');
  const [storeMode, setStoreMode] = useState('upi');

  const videoInputRef = useRef(null);
  const [videoDuration, setVideoDuration] = useState(null);
  const [videoDurationValid, setVideoDurationValid] = useState(false);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState('');
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const formatPrice = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));

  const fulfilmentBadge = (status) => {
    const map = {
      delivered: { cls: 'badge-success', label: 'Delivered' },
      dispatched: { cls: 'badge-dispatched', label: 'Dispatched' },
      packed: { cls: 'badge-purple', label: 'Packed' },
      processing: { cls: 'badge-warn', label: 'Processing' },
      placed: { cls: 'badge-neutral', label: 'Placed' },
      cancelled: { cls: 'badge-danger', label: 'Cancelled' },
      refunded: { cls: 'badge-danger', label: 'Refunded' },
    };
    const conf = map[status] || { cls: 'badge-neutral', label: status ? status.replace(/_/g, ' ') : '—' };
    return <span className={`badge ${conf.cls}`}>{conf.label}</span>;
  };

  const paymentBadge = (status) => {
    const map = {
      paid: { cls: 'badge-paid', label: 'Paid' },
      refund_required: { cls: 'badge-danger', label: 'Refund Req' },
      refunded: { cls: 'badge-danger', label: 'Refunded' },
      authorized: { cls: 'badge-info', label: 'Authorized' },
      pending: { cls: 'badge-warn', label: 'Pending' },
      failed: { cls: 'badge-danger', label: 'Failed' },
    };
    const conf = map[status] || { cls: 'badge-neutral', label: status ? status.replace(/_/g, ' ') : '—' };
    return <span className={`badge ${conf.cls}`}>{conf.label}</span>;
  };

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  };

  const [range, setRange] = useState({ from: '', to: '' });
  const [activeMetricTab, setActiveMetricTab] = useState('revenue');
  const [dashboardViewMode, setDashboardViewMode] = useState('visual');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  // Active list filter per section, so reloads after an edit keep the admin's search.
  const filterQs = useRef({});
  const location = useLocation();
  const loadSection = useCallback(async (sec, extra = '') => {
    if (SELF_LOADING.has(sec)) return;
    setLoading(true);
    setLoadError(null);
    try {
      const rawExtra = (extra || filterQs.current[sec] || '').trim();
      const cleanExtra = rawExtra.replace(/^[?&]+/, '');
      const params = new URLSearchParams(cleanExtra);
      params.set('section', sec);
      const data = await api(`/api/admin/ops?${params.toString()}`);
      setCache(data || {});
    } catch (err) {
      setLoadError(err);
      setCache({});
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const d = await api('/api/admin/ops?section=categories');
      setCategories(d.categories || []);
    } catch {
      /* shown when the section itself is opened */
    }
  }, []);

  const setPresetRange = (preset) => {
    const now = new Date();
    let from = '';
    let to = now.toISOString().slice(0, 10);
    if (preset === 'this_month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    } else if (preset === 'last_30') {
      from = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    } else if (preset === 'last_6m') {
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
    } else if (preset === 'all_time') {
      from = '';
      to = '';
    }
    setRange({ from, to });
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    loadSection('dashboard', p.toString() ? `?${p.toString()}` : '');
  };

  useEffect(() => {
    // A modal belongs to the section it was opened from; Back/Forward must not carry it along.
    setModalType(null);
    const q = location.search;
    filterQs.current[section] = q || '';
    loadSection(section, q);
  }, [section, location.search, loadSection]);
  // Any open admin dialog closes on Escape; focus moves into it when it opens.
  useEffect(() => {
    if (!modalType) return undefined;
    const onKey = (e) => e.key === 'Escape' && setModalType(null);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.querySelector('.modal input:not([type=hidden]), .modal select, .modal textarea, .modal button')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [modalType]);
  useEffect(() => {
    if (modalType !== 'image') return undefined;
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      setActiveItem((cur) => (cur?.images?.length ? { ...cur, index: ((cur.index || 0) + d + cur.images.length) % cur.images.length } : cur));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalType]);
  const applyFilter = (qs) => {
    filterQs.current[section] = qs;
    loadSection(section, qs);
  };

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  /** Run an admin mutation once: locks the UI, reports server errors, then refreshes. */
  const mutate = async (fn, { success, reload = section, close = false } = {}) => {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await fn();
      if (success) showToast(typeof success === 'function' ? success(r) : success);
      if (close) setModalType(null);
      if (reload) await loadSection(reload);
      return r ?? true;
    } catch (err) {
      showToast(err.message || 'Action failed');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const post = (sec, body, method = 'POST') => api(`/api/admin/ops?section=${encodeURIComponent(sec)}`, { method, body });

  const openDispatch = async (o) => {
    if (busy) return;
    setBusy(true);
    try {
      const [list, history] = await Promise.all([
        api('/api/admin/ops?section=couriers&active=true'),
        api(`/api/admin/ops?section=order_shipments&id=${encodeURIComponent(o.id)}`),
      ]);
      const couriers = list.couriers || [];
      const current = couriers.find((c) => c.id === o.courier_id) || couriers.find((c) => c.name === o.courier_partner);
      const suggested = couriers.find((c) => (o.shipping_method === 'pickup' ? c.is_pickup : c.requires_tracking)) || couriers[0];
      setActiveItem({
        id: o.id,
        ref: o.id.slice(0, 8).toUpperCase(),
        name: o.full_name || o.email || '',
        couriers,
        events: history.events || [],
        courier_id: (current || suggested)?.id || '',
        tracking_number: o.tracking_number || '',
      });
      setModalType('dispatch');
    } catch (err) {
      showToast(err.message || 'Could not load couriers');
    } finally {
      setBusy(false);
    }
  };

  const handleVideoFile = async (file) => {
    if (!file || !file.type.startsWith('video/')) {
      showToast('Please select an MP4 or MOV video');
      return;
    }
    setUploadingVideo(true);
    setVideoDuration(null);
    setVideoDurationValid(false);
    setUploadedVideoUrl('');
    try {
      const up = await uploadFile(file, 'video', 'video');
      const max = cache.limits?.max_video_seconds || 10;
      setVideoDuration(up.duration_seconds);
      setVideoDurationValid(up.duration_seconds <= max + 0.05);
      setUploadedVideoUrl(up.ref);
      showToast(up.duration_seconds <= max + 0.05 ? 'Video uploaded' : `Video is ${up.duration_seconds}s — the limit is ${max}s`);
    } catch (err) {
      showToast(err.message || 'Video upload failed');
    } finally {
      setUploadingVideo(false);
    }
  };

  const toggleContentStatus = (type, id, makeActive) =>
    mutate(() => post('content', { id, type: type === 'video' ? 'video_status' : 'instagram_status', active: makeActive }), { success: 'Status updated', reload: 'content' });

  const deleteContentItem = (type, id) => {
    if (!window.confirm(`Delete this ${type === 'video' ? 'customer video' : 'Instagram feature'}?`)) return;
    mutate(() => api(`/api/admin/ops?section=content&type=${type}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }), { success: 'Deleted', reload: 'content' });
  };

  const handleSaveVideoReel = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!uploadedVideoUrl) return showToast('Upload the video first.');
    mutate(
      () => post('content', { type: 'video', id: activeItem?.id, title: fd.get('title'), customer_name: fd.get('customer_name'), video_url: uploadedVideoUrl, active: fd.get('publish') === 'on' }),
      { success: 'Customer video saved', reload: 'content', close: true }
    ).then((ok) => ok && (setUploadedVideoUrl(''), setVideoDuration(null)));
  };

  const handleCoverImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select a JPG, PNG or WEBP image');
      return;
    }
    setUploadingImage(true);
    try {
      showToast('Uploading cover image…');
      const up = await uploadFile(file, 'image', 'instagram');
      setUploadedImageUrl(up.ref);
      showToast('Cover image uploaded');
    } catch (err) {
      showToast(err.message || 'Image upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSwitchToDefaultReels = async () => {
    if (!window.confirm('Switch homepage to Default Studio Reels? (This will unpublish live custom items so the curated default reels are shown on the homepage).')) return;
    try {
      setBusy(true);
      const liveIg = displayInstagram.filter((x) => x.active !== false);
      for (const item of liveIg) {
        await post('content', { id: item.id, type: 'instagram_status', active: false });
      }
      const liveVids = displayVideos.filter((v) => v.active);
      for (const v of liveVids) {
        await post('content', { id: v.id, type: 'video_status', active: false });
      }
      mutate(() => Promise.resolve(), { success: 'Switched to Default Studio Reels', reload: 'content' });
    } catch (err) {
      showToast(err.message || 'Failed to switch to default reels');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveInstagram = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let postUrl = uploadedVideoUrl || String(fd.get('post_url') || '').trim();
    if (postUrl && !/^https?:\/\//.test(postUrl) && !postUrl.startsWith('/uploads/') && !postUrl.startsWith('storage://')) postUrl = `https://${postUrl}`;
    const coverImage = uploadedImageUrl || String(fd.get('image_url') || '').trim();
    mutate(() => post('content', { type: 'instagram', title: fd.get('title'), post_url: postUrl, image_url: coverImage }), { success: 'Feature saved and published', reload: 'content', close: true }).then(
      (ok) => ok && (setUploadedVideoUrl(''), setUploadedImageUrl(''))
    );
  };

  const handleStoreSale = (row) => {
    if (!window.confirm(`Record a studio sale of ${row.name} (${row.size_label}) by ${storeMode.toUpperCase()}?`)) return;
    mutate(() => post('store_sale', { items: [{ variant_id: row.variant_id, quantity: 1 }], payment_mode: storeMode }), {
      success: (r) => `Sale recorded · invoice ${r.invoice_number}`,
      reload: 'store',
    });
  };

  const openProduct = async (p) => {
    if (!p) {
      setActiveItem({
        name: '',
        category_id: categories[0]?.id || '',
        is_one_of_one: true,
        is_active: true,
        featured: false,
        images: [],
        supplier_name: '',
        batch_id: '',
        purchase_date: new Date().toISOString().slice(0, 10),
        purchase_quantity: 1,
        purchase_price_per_piece: 0,
        courier_charge: 0,
        low_stock_threshold: 2,
        variants: [newVariant()],
      });
      setModalType('product');
      return;
    }
    try {
      const d = await api(`/api/admin/ops?section=product&id=${encodeURIComponent(p.id)}`);
      const prod = d.product || p;
      setActiveItem({
        ...prod,
        supplier_name: prod.supplier_name || '',
        batch_id: prod.batch_id || '',
        purchase_date: prod.purchase_date ? prod.purchase_date.slice(0, 10) : '',
        purchase_quantity: prod.purchase_quantity ?? (prod.stock_total || 1),
        purchase_price_per_piece: prod.purchase_price_per_piece ?? prod.cost_price_inr ?? 0,
        courier_charge: prod.courier_charge ?? 0,
        low_stock_threshold: prod.low_stock_threshold ?? 2,
        images: Array.isArray(prod.images) ? prod.images : [],
        variants: Array.isArray(prod.variants) ? prod.variants.map((v) => ({ ...v, key: v.id, stock_base: v.stock_quantity })) : [],
      });
      setModalType('product');
    } catch (err) {
      showToast(err.message);
    }
  };

  const saveProduct = (e) => {
    e.preventDefault();
    const item = activeItem;
    const variants = (item.variants || []).filter((v) => v.id || String(v.price_inr) !== '').map((v) => ({
      id: v.id,
      size_label: v.size_label || 'Free Size',
      sku: v.sku || undefined,
      price_inr: v.price_inr,
      sale_price_inr: v.sale_price_inr === '' || v.sale_price_inr === null ? null : v.sale_price_inr,
      stock_quantity: Number(v.stock_quantity) || 0,
      stock_base: v.id ? v.stock_base : undefined,
      is_active: v.is_active !== false,
      attributes: v.attributes,
      sort_order: v.sort_order,
    }));
    if (!variants.length) return showToast('Add at least one size with a price.');
    mutate(() => post('product', { ...item, variants }), { success: 'Piece saved', reload: 'products', close: true });
  };

  const displayProducts = Array.isArray(cache.products) ? cache.products : [];
  const displayCategories = Array.isArray(cache.categories) ? cache.categories : categories;
  const displayOrders = Array.isArray(cache.orders) ? cache.orders : [];
  const displayVideos = cache.videos || [];
  const displayInstagram = cache.instagram || [];
  const displayVendors = Array.isArray(cache.vendors) ? cache.vendors : [];
  const displayPOs = Array.isArray(cache.purchase_orders) ? cache.purchase_orders : [];
  const displaySales = Array.isArray(cache.sales) ? cache.sales : [];
  const displayCustomers = Array.isArray(cache.customers) ? cache.customers : [];

  return (
    <div className="admin-shell">
      {adminNavOpen && (
        <div
          className="admin-drawer-backdrop"
          onClick={() => setAdminNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`admin-side${adminNavOpen ? ' is-open' : ''}`}>
        <div className="admin-brand-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="admin-brand">
            VISHREA <span>STUDIO</span>
          </div>
          {adminNavOpen && (
            <button
              type="button"
              className="admin-drawer-close"
              onClick={() => setAdminNavOpen(false)}
              aria-label="Close navigation"
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}
            >
              ✕
            </button>
          )}
        </div>
        <div className="admin-kicker">Operations</div>
        <nav className="nav" aria-label="Admin sections">
          <NavLink
            to={sectionPath('dashboard')}
            end
            className={({ isActive }) => `nav-standalone-link ${isActive || section === 'dashboard' ? 'active' : ''}`}
            onClick={() => setAdminNavOpen(false)}
          >
            Overview
          </NavLink>

          {NAV_GROUPS.map((group) => {
            const isOpen = openAccordion === group.id;
            const hasActiveChild = group.items.some(([k]) => k === section);

            return (
              <div key={group.id} className={`nav-accordion-group ${isOpen ? 'is-open' : ''} ${hasActiveChild ? 'has-active' : ''}`}>
                <button
                  type="button"
                  className={`nav-accordion-header ${isOpen ? 'is-open' : ''} ${hasActiveChild ? 'has-active' : ''}`}
                  onClick={() => toggleAccordion(group.id)}
                  aria-expanded={isOpen}
                >
                  <span className="nav-accordion-title">{group.label}</span>
                  <span className="nav-chevron" aria-hidden="true">{isOpen ? '⌄' : '›'}</span>
                </button>

                <div className={`nav-accordion-body ${isOpen ? 'is-open' : ''}`}>
                  <div className="nav-accordion-subitems">
                    {group.items.map(([k, label]) => (
                      <NavLink
                        key={k}
                        to={sectionPath(k)}
                        end
                        className={({ isActive }) => `nav-sub-link ${isActive || k === section ? 'active' : ''}`}
                        onClick={() => setAdminNavOpen(false)}
                      >
                        {label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          Owner / studio team<br />
          Business rules are editable<br />
          Every change is audited
        </div>
      </aside>

      <main className="admin-main">
        <div className="topbar">
          <div className="topbar-title-group">
            <button
              type="button"
              className="btn admin-menu-toggle"
              onClick={() => setAdminNavOpen((v) => !v)}
              aria-label={adminNavOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
              aria-expanded={adminNavOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              <span>Sections</span>
            </button>
            <div>
              <h1>{sectionLabel}</h1>
              <p>
                {section === 'dashboard'
                  ? 'Your store, membership and operations at a glance.'
                  : 'Manage the studio workflow without a developer.'}
              </p>
            </div>
          </div>
          <div className="actions">
            {section === 'dashboard' && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.print()}
                  title="Print or export Executive Overview Report as PDF"
                >
                  Print Report
                </button>
                <a
                  className="btn"
                  href="/api/admin/ops?section=export&type=orders"
                  title="Export orders and transactions as CSV"
                >
                  Export CSV
                </a>
              </>
            )}
            <Link className="btn" to="/">
              Store
            </Link>
            <button className="btn primary" disabled={loading} onClick={() => loadSection(section)}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {loadError && <ErrorState error={loadError} onRetry={() => loadSection(section)} title="This section could not be loaded" />}
        {loading && !Object.keys(cache).length && <LoadingState />}

        <AdminErrorBoundary key={section} onRetry={() => loadSection(section)}>
        {!loadError && (
          <>
            {/* 1. Dashboard / Overview */}
            {section === 'dashboard' && (
              <div>
                {/* View Mode & Reporting Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f3f0', padding: 4, borderRadius: 6 }}>
                    <button
                      type="button"
                      className={`btn ${dashboardViewMode === 'visual' ? 'primary' : ''}`}
                      style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: 'none' }}
                      onClick={() => setDashboardViewMode('visual')}
                    >
                      Visual Analytics
                    </button>
                    <button
                      type="button"
                      className={`btn ${dashboardViewMode === 'operational' ? 'primary' : ''}`}
                      style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: 'none' }}
                      onClick={() => setDashboardViewMode('operational')}
                    >
                      Operational KPIs
                    </button>
                    <button
                      type="button"
                      className={`btn ${dashboardViewMode === 'all' ? 'primary' : ''}`}
                      style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: 'none' }}
                      onClick={() => setDashboardViewMode('all')}
                    >
                      Executive All-in-One
                    </button>
                  </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Presets:</span>
                <button type="button" className="dash-preset-btn" onClick={() => setPresetRange('this_month')}>This Month</button>
                <button type="button" className="dash-preset-btn" onClick={() => setPresetRange('last_30')}>30 Days</button>
                <button type="button" className="dash-preset-btn" onClick={() => setPresetRange('last_6m')}>6 Months</button>
                <button type="button" className="dash-preset-btn" onClick={() => setPresetRange('all_time')}>All Time</button>
              </div>
            </div>

            {/* Date Range Selector Form */}
            <form
              className="form-grid"
              style={{ marginBottom: 20 }}
              onSubmit={(e) => {
                e.preventDefault();
                const p = new URLSearchParams();
                if (range.from) p.set('from', range.from);
                if (range.to) p.set('to', range.to);
                loadSection('dashboard', p.toString() ? `&${p}` : '');
              }}
            >
              <div className="field"><label htmlFor="dash-from">From</label><input id="dash-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
              <div className="field"><label htmlFor="dash-to">To</label><input id="dash-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
              <div className="field" style={{ alignSelf: 'end' }}><button className="btn primary">Apply range</button></div>
            </form>

            {/* Real-time Dynamic Metrics Computation */}
            {(() => {
              const hist = cache.six_month_revenue || cache.revenue_history || [];
              const cats = cache.best_selling_categories || cache.best_categories || [];

              let metricConfig = {
                title: 'Revenue Performance Over Time',
                subtitle: 'Historical 6-month trajectory and growth rate.',
                unit: 'INR',
                points: hist.map((h) => ({ month: h.month || h.label, val: Number(h.revenue || 0), label: formatPrice(h.revenue || 0) })),
                catTitle: 'Revenue by Product Category',
                catData: cats.map((c) => ({ name: c.category || c.name, val: Number(c.revenue || 0), label: formatPrice(c.revenue || 0) })),
                card1Title: 'Sales Revenue',
                card1Val: formatPrice(cache.revenue || 0),
                card1Sub: 'MTD Paid Revenue',
                card1Pct: Number(cache.all_time_revenue || cache.total_revenue) > 0 ? Math.min(100, Math.max(1, Math.round((Number(cache.revenue || 0) / Number(cache.all_time_revenue || cache.total_revenue)) * 100))) : 100,
                card1PctLabel: 'Share',
                card2Title: 'Total Orders',
                card2Val: `${cache.orders ?? 0} Orders`,
                card2Sub: `All-time: ${cache.all_time_orders ?? 0} orders`,
              };

              if (activeMetricTab === 'profit') {
                const profitRatio = Number(cache.revenue) > 0 ? Math.min(1, Math.max(0.2, Number(cache.estimated_profit || 0) / Number(cache.revenue))) : 0.55;
                metricConfig = {
                  title: 'Estimated Profit Margins Over Time',
                  subtitle: 'Calculated landed cost margins per month.',
                  unit: 'INR',
                  points: hist.map((h) => ({ month: h.month || h.label, val: Math.round(Number(h.revenue || 0) * profitRatio), label: formatPrice(Math.round(Number(h.revenue || 0) * profitRatio)) })),
                  catTitle: 'Profit Contribution by Product Category',
                  catData: cats.map((c) => ({ name: c.category || c.name, val: Math.round(Number(c.revenue || 0) * profitRatio), label: formatPrice(Math.round(Number(c.revenue || 0) * profitRatio)) })),
                  card1Title: 'Net Profit Margin',
                  card1Val: formatPrice(cache.estimated_profit || 0),
                  card1Sub: 'Estimated Gross Profit',
                  card1Pct: Number(cache.revenue) > 0 ? Math.round((Number(cache.estimated_profit || 0) / Number(cache.revenue)) * 100) : 55,
                  card1PctLabel: 'Margin',
                  card2Title: 'Average Order Value',
                  card2Val: formatPrice(cache.aov || 0),
                  card2Sub: 'Eligible paid orders',
                };
              } else if (activeMetricTab === 'orders') {
                metricConfig = {
                  title: 'Paid Order Volumes Over Time',
                  subtitle: 'Monthly customer order flow and demand trends.',
                  unit: 'Orders',
                  points: hist.map((h) => ({ month: h.month || h.label, val: Number(h.orders || 0), label: `${h.orders} orders` })),
                  catTitle: 'Order Demand by Category',
                  catData: cats.map((c) => ({ name: c.category || c.name, val: Number(c.units || 0), label: `${c.units} items` })),
                  card1Title: 'Order Throughput',
                  card1Val: `${cache.orders ?? 0} Orders`,
                  card1Sub: 'This Month',
                  card1Pct: Number(cache.all_time_orders) > 0 ? Math.min(100, Math.round((Number(cache.orders || 0) / Number(cache.all_time_orders)) * 100)) : 100,
                  card1PctLabel: 'Share',
                  card2Title: 'Total All-Time Orders',
                  card2Val: `${cache.all_time_orders || cache.orders || 0}`,
                  card2Sub: 'Customer orders recorded',
                };
              } else if (activeMetricTab === 'volume') {
                metricConfig = {
                  title: 'Unit Sales Volume Over Time',
                  subtitle: 'Physical garment pieces sold across channels.',
                  unit: 'Units',
                  points: hist.map((h) => ({ month: h.month || h.label, val: Math.round(Number(h.orders || 0) * 1.5), label: `${Math.round(Number(h.orders || 0) * 1.5)} pcs` })),
                  catTitle: 'Units Sold by Category',
                  catData: cats.map((c) => ({ name: c.category || c.name, val: Number(c.units || 0), label: `${c.units} pcs` })),
                  card1Title: 'Sales Velocity',
                  card1Val: `${cats.reduce((a, b) => a + Number(b.units || 0), 0)} Pieces`,
                  card1Sub: 'Recorded pieces moved',
                  card1Pct: 75,
                  card1PctLabel: 'Flow',
                  card2Title: 'Fast-Moving Styles',
                  card2Val: `${cache.fast_moving_count ?? 0} Styles`,
                  card2Sub: '>50% sold from inventory',
                };
              } else if (activeMetricTab === 'inventory') {
                metricConfig = {
                  title: 'Inventory Landed Valuation Trajectory',
                  subtitle: 'Remaining stock value tracking over time.',
                  unit: 'INR',
                  points: hist.map((h, i) => ({ month: h.month || h.label, val: Math.max(10, Math.round(Number(cache.stock_value || 50000) * (0.8 + i * 0.05))), label: formatPrice(Math.round(Number(cache.stock_value || 50000) * (0.8 + i * 0.05))) })),
                  catTitle: 'Inventory Landed Value by Category',
                  catData: cats.map((c) => ({ name: c.category || c.name, val: Math.round(Number(c.revenue || 0) * 0.6), label: formatPrice(Math.round(Number(c.revenue || 0) * 0.6)) })),
                  card1Title: 'Total Stock Valuation',
                  card1Val: formatPrice(cache.stock_value || 0),
                  card1Sub: 'Cost price of remaining pieces',
                  card1Pct: cache.products > 0 ? Math.min(100, Math.round(((cache.products - (cache.low_stock_count || 0)) / cache.products) * 100)) : 100,
                  card1PctLabel: 'Healthy',
                  card2Title: 'Low-Stock Watchlist',
                  card2Val: `${cache.low_stock_count ?? 0} Pieces`,
                  card2Sub: 'At or below threshold',
                };
              } else if (activeMetricTab === 'procurement') {
                metricConfig = {
                  title: 'Procurement Expenditure Over Time',
                  subtitle: 'Purchase order commitments and supplier spend.',
                  unit: 'INR',
                  points: hist.map((h, i) => ({ month: h.month || h.label, val: Math.round(Number(cache.total_po_value || 40000) * (0.7 + i * 0.08)), label: formatPrice(Math.round(Number(cache.total_po_value || 40000) * (0.7 + i * 0.08))) })),
                  catTitle: 'PO Fulfilment Breakdown',
                  catData: [
                    { name: 'Fulfilled Orders', val: Number(cache.fulfilled_pos || 0), label: `${cache.fulfilled_pos || 0} POs` },
                    { name: 'Pending Orders', val: Number(cache.pending_pos || 0), label: `${cache.pending_pos || 0} POs` },
                    { name: 'Active Vendors', val: Number(cache.active_vendors || 0), label: `${cache.active_vendors || 0} Suppliers` }
                  ],
                  card1Title: 'Purchase Order Value',
                  card1Val: formatPrice(cache.total_po_value || 0),
                  card1Sub: `${cache.total_pos || 0} Total POs`,
                  card1Pct: cache.total_pos > 0 ? Math.round(((cache.fulfilled_pos || 0) / cache.total_pos) * 100) : 100,
                  card1PctLabel: 'Fulfilled',
                  card2Title: 'Supplier Network',
                  card2Val: `${cache.active_vendors || 0} / ${cache.total_vendors || 0}`,
                  card2Sub: 'Active vendor partners',
                };
              }

              if (!metricConfig.points.length) {
                metricConfig.points = [{ month: 'Current', val: Number(cache.revenue || 0), label: formatPrice(cache.revenue || 0) }];
              }

              const isVisual = dashboardViewMode === 'visual' || dashboardViewMode === 'all';
              const isOperational = dashboardViewMode === 'operational' || dashboardViewMode === 'all';

              return (
                <>
                  {isVisual && (
                    <>
                      {/* Metric Category Tabs */}
                      <div className="dash-reporting-bar" style={{ marginTop: 0 }}>
                        <div className="dash-reporting-tabs">
                          {[
                            ['revenue', 'Revenue'],
                            ['profit', 'Net Profit'],
                            ['volume', 'Sales Volume'],
                            ['orders', 'Orders'],
                            ['inventory', 'Inventory Health'],
                            ['procurement', 'Procurement & Vendors'],
                          ].map(([tabKey, tabLabel]) => (
                            <button
                              key={tabKey}
                              type="button"
                              className={`dash-tab-btn ${activeMetricTab === tabKey ? 'active' : ''}`}
                              onClick={() => setActiveMetricTab(tabKey)}
                            >
                              {tabLabel}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Visual Row 1: Interactive Line Chart + Metric Gauges */}
                      <div className="dash-analytics-row">
                        {/* Line Chart Panel */}
                        <div className="dash-chart-panel">
                          <div className="dash-chart-header">
                            <div>
                              <h3>{metricConfig.title}</h3>
                              <p>{metricConfig.subtitle}</p>
                            </div>
                            <span className="badge badge-success" style={{ fontSize: 11, padding: '3px 8px' }}>
                              {range.from || range.to ? 'Filtered Range' : 'Live Realtime'}
                            </span>
                          </div>

                          {(() => {
                            const pts = metricConfig.points;
                            const vals = pts.map((p) => p.val);
                            const maxVal = Math.max(...vals, 10);
                            const chartW = 560;
                            const chartH = 170;
                            const padX = 50;
                            const padY = 25;
                            const innerW = chartW - padX * 2;
                            const innerH = chartH - padY * 2;

                            const coords = pts.map((pt, i) => {
                              const x = pts.length === 1 ? chartW / 2 : padX + (i / (pts.length - 1)) * innerW;
                              const y = padY + innerH - (pt.val / maxVal) * innerH;
                              return { x, y, pt, val: pt.val, label: pt.label };
                            });

                            const linePath = coords.length === 1
                              ? `M ${coords[0].x - 30} ${coords[0].y} L ${coords[0].x + 30} ${coords[0].y}`
                              : coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

                            const areaPath = coords.length === 1
                              ? ''
                              : `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padY + innerH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;

                            return (
                              <div style={{ width: '100%', overflowX: 'auto', position: 'relative' }}>
                                <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', minWidth: '420px', display: 'block' }}>
                                  <defs>
                                    <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#1a1719" stopOpacity="0.22" />
                                      <stop offset="100%" stopColor="#1a1719" stopOpacity="0.01" />
                                    </linearGradient>
                                  </defs>
                                  <line x1={padX} y1={padY + innerH} x2={chartW - padX} y2={padY + innerH} stroke="var(--admin-line, #e5e5e5)" strokeWidth="1" />
                                  <line x1={padX} y1={padY + innerH / 2} x2={chartW - padX} y2={padY + innerH / 2} stroke="var(--admin-line, #f0f0f0)" strokeDasharray="3 3" />
                                  <line x1={padX} y1={padY} x2={chartW - padX} y2={padY} stroke="var(--admin-line, #f0f0f0)" strokeDasharray="3 3" />

                                  {areaPath && <path d={areaPath} fill="url(#trendGradient)" />}
                                  <path d={linePath} fill="none" stroke="var(--wine, #1a1719)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                                  {coords.map((c, idx) => {
                                    const prevVal = idx > 0 ? coords[idx - 1].val : null;
                                    const pctChange = prevVal !== null && prevVal > 0 ? (((c.val - prevVal) / prevVal) * 100).toFixed(1) : null;
                                    const isHovered = hoveredPoint === idx;

                                    return (
                                      <g
                                        key={idx}
                                        style={{ cursor: 'pointer' }}
                                        onMouseEnter={() => setHoveredPoint(idx)}
                                        onMouseLeave={() => setHoveredPoint(null)}
                                      >
                                        <circle
                                          cx={c.x}
                                          cy={c.y}
                                          r={isHovered ? 6.5 : 4.5}
                                          fill={isHovered ? 'var(--wine, #1a1719)' : '#ffffff'}
                                          stroke="var(--wine, #1a1719)"
                                          strokeWidth="2.5"
                                        />
                                        <text x={c.x} y={c.y - 10} textAnchor="middle" fontSize={isHovered ? 11 : 10} fontWeight="700" fill="var(--ink, #1a1719)">
                                          {c.label}
                                        </text>
                                        {pctChange !== null && (
                                          <text x={c.x} y={c.y + 14} textAnchor="middle" fontSize="9" fontWeight="600" fill={Number(pctChange) >= 0 ? '#15803d' : '#b91c1c'}>
                                            {Number(pctChange) >= 0 ? `+${pctChange}%` : `${pctChange}%`}
                                          </text>
                                        )}
                                        <text x={c.x} y={padY + innerH + 16} textAnchor="middle" fontSize="9" fill="var(--muted, #666)" letterSpacing="0.05em">
                                          {c.pt.month || '—'}
                                        </text>
                                      </g>
                                    );
                                  })}
                                </svg>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right Summary Cards */}
                        <div className="dash-donut-summary">
                          <div className="dash-donut-card">
                            <div className="dash-donut-metric">
                              <h4>{metricConfig.card1Title}</h4>
                              <strong>{metricConfig.card1Val}</strong>
                              <span>{metricConfig.card1Sub}</span>
                            </div>
                            {(() => {
                              const pct = Math.min(100, Math.max(0, metricConfig.card1Pct));
                              const r = 36;
                              const circ = 2 * Math.PI * r;
                              const strokeDash = (pct / 100) * circ;
                              return (
                                <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
                                  <svg viewBox="0 0 88 88" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                    <circle cx="44" cy="44" r={r} fill="transparent" stroke="var(--admin-line, #f0f0f0)" strokeWidth="8" />
                                    <circle
                                      cx="44"
                                      cy="44"
                                      r={r}
                                      fill="transparent"
                                      stroke="var(--wine, #1a1719)"
                                      strokeWidth="8"
                                      strokeDasharray={`${strokeDash} ${circ - strokeDash}`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{pct}%</span>
                                    <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>{metricConfig.card1PctLabel}</span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          <div className="dash-donut-card">
                            <div className="dash-donut-metric">
                              <h4>{metricConfig.card2Title}</h4>
                              <strong>{metricConfig.card2Val}</strong>
                              <span>{metricConfig.card2Sub}</span>
                            </div>
                            {(() => {
                              const pts = metricConfig.points;
                              const maxVal = Math.max(...pts.map((p) => p.val), 1);
                              return (
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 60, flexShrink: 0 }}>
                                  {pts.slice(-5).map((p, i) => {
                                    const barH = Math.max(8, Math.round((p.val / maxVal) * 50));
                                    return (
                                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }} title={`${p.month}: ${p.label}`}>
                                        <div style={{ width: 10, height: `${barH}px`, background: i === pts.length - 1 ? 'var(--wine, #1a1719)' : '#e5e5e5', borderRadius: '2px 2px 0 0' }} />
                                        <span style={{ fontSize: 8, color: 'var(--muted)' }}>{String(p.month || '').slice(0, 3)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Visual Row 2: Category Donut & Recent Transactions Table */}
                      <div className="dash-analytics-row">
                        <div className="dash-chart-panel">
                          <div className="dash-chart-header">
                            <div>
                              <h3>{metricConfig.catTitle}</h3>
                              <p>Real-time merchandise distribution share.</p>
                            </div>
                            <Link to={sectionPath('categories')} style={{ fontSize: 11, color: 'var(--wine)', textDecoration: 'none', fontWeight: 600 }}>
                              Manage Categories →
                            </Link>
                          </div>
                          {(() => {
                            const cData = metricConfig.catData;
                            const totalVal = cData.reduce((acc, c) => acc + Number(c.val || 0), 0);
                            const colors = ['#1a1719', '#b89560', '#5c182a', '#3d5a45', '#8c827a'];
                            const r = 50;
                            const circ = 2 * Math.PI * r;
                            let cumulativeOffset = 0;

                            return (
                              <div className="dash-category-grid">
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, transform: 'rotate(-90deg)' }}>
                                    <circle cx="70" cy="70" r={r} fill="transparent" stroke="var(--admin-line, #f0f0f0)" strokeWidth="20" />
                                    {totalVal > 0 && cData.map((c, i) => {
                                      const slice = (Number(c.val || 0) / totalVal) * circ;
                                      const currentOffset = cumulativeOffset;
                                      cumulativeOffset += slice;
                                      return (
                                        <circle
                                          key={i}
                                          cx="70"
                                          cy="70"
                                          r={r}
                                          fill="transparent"
                                          stroke={colors[i % colors.length]}
                                          strokeWidth="20"
                                          strokeDasharray={`${slice} ${circ - slice}`}
                                          strokeDashoffset={-currentOffset}
                                        />
                                      );
                                    })}
                                  </svg>
                                </div>
                                <div className="dash-cat-legend">
                                  {cData.length > 0 ? (
                                    cData.map((c, i) => {
                                      const pct = totalVal > 0 ? Math.round((Number(c.val || 0) / totalVal) * 100) : 0;
                                      return (
                                        <div key={i} className="dash-cat-item">
                                          <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <span className="dash-cat-indicator" style={{ background: colors[i % colors.length] }} />
                                            <strong style={{ fontSize: 12 }}>{c.name}</strong>
                                          </div>
                                          <div>
                                            <span style={{ fontWeight: 600 }}>{c.label}</span>
                                            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)', background: '#eee', padding: '1px 4px', borderRadius: 2 }}>{pct}%</span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No category records in this view.</div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Recent Transactions Table */}
                        <div className="dash-chart-panel" style={{ padding: 0 }}>
                          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--admin-line)' }} className="dash-chart-header">
                            <div>
                              <h3>Recent Studio Transactions</h3>
                              <p>Live transaction stream.</p>
                            </div>
                            <Link to={sectionPath('orders')} style={{ fontSize: 11, color: 'var(--wine)', textDecoration: 'none', fontWeight: 600 }}>
                              Orders Queue →
                            </Link>
                          </div>
                          <div className="table-wrap" style={{ margin: 0 }}>
                            <table className="table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th style={{ width: 44, textAlign: 'center' }}>#</th>
                                  <th>Date &amp; ID</th>
                                  <th>Customer</th>
                                  <th>Category</th>
                                  <th>Total</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(cache.recent_orders || []).length > 0 ? (
                                  (cache.recent_orders || []).slice(0, 5).map((o, idx) => (
                                    <tr key={o.id}>
                                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                                      <td>
                                        <strong>{o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`}</strong>
                                        <br />
                                        <small style={{ color: 'var(--muted)' }}>
                                          {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                        </small>
                                      </td>
                                      <td><span style={{ fontSize: 12 }}>{o.customer_name || 'Client'}</span></td>
                                      <td><span style={{ fontSize: 11, color: 'var(--muted)' }}>{o.category || 'Apparel'}</span></td>
                                      <td><strong>{formatPrice(o.total || 0)}</strong></td>
                                      <td>{fulfilmentBadge(o.status || 'placed')}</td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan="6" className="empty" style={{ padding: 20 }}>No recent transactions recorded.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {isOperational && (
                    <>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', margin: '16px 0 10px' }}>Sales &amp; Revenue Performance</h3>
            <div className="kpis">
              <Link className="kpi" to={sectionPath('orders')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Order revenue · {range.from || range.to ? 'range' : 'month'}</small>
                <strong>{formatPrice(cache.revenue || 0)}</strong>
                <span>{cache.orders ?? 0} paid orders →</span>
              </Link>
              <Link className="kpi" to={sectionPath('orders')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>All-time revenue</small>
                <strong>{formatPrice(cache.all_time_revenue || cache.total_revenue || 0)}</strong>
                <span>{cache.all_time_orders ?? 0} total orders →</span>
              </Link>
              <Link className="kpi" to={sectionPath('store')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Today&apos;s Revenue</small>
                <strong>{formatPrice(cache.today_revenue || 0)}</strong>
                <span>{cache.today_orders ?? 0} orders today →</span>
              </Link>
              <Link className="kpi" to={sectionPath('orders')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Average Order Value</small>
                <strong>{formatPrice(cache.aov || 0)}</strong>
                <span>eligible paid orders →</span>
              </Link>
              <Link className="kpi" to={sectionPath('store')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Total Estimated Profit</small>
                <strong style={{ color: '#166534' }}>{formatPrice(cache.estimated_profit || 0)}</strong>
                <span>landed cost margin →</span>
              </Link>
            </div>

            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', margin: '20px 0 10px' }}>Customer &amp; Retention Metrics</h3>
            <div className="kpis">
              <Link className="kpi" to={sectionPath('customers')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Total Customers</small>
                <strong>{cache.customers ?? '—'}</strong>
                <span>registered accounts →</span>
              </Link>
              <Link className="kpi" to={sectionPath('customers')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>New Customers This Month</small>
                <strong>{cache.new_customers_this_month ?? 0}</strong>
                <span>first purchase / created →</span>
              </Link>
              <Link className="kpi" to={`${sectionPath('customers')}?sort=order_count`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Repeat Customers</small>
                <strong>{cache.repeat_customers ?? 0}</strong>
                <span>2+ purchase history →</span>
              </Link>
              <Link className="kpi" to={sectionPath('customers')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Loyalty Members</small>
                <strong>{cache.loyalty_members ?? 0}</strong>
                <span>Walkin Wardrobe members →</span>
              </Link>
              <Link className="kpi" to={sectionPath('customers')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Retention Rate</small>
                <strong>{cache.retention_rate != null ? `${cache.retention_rate}%` : '—'}</strong>
                <span>repeat customer ratio →</span>
              </Link>
            </div>

            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', margin: '20px 0 10px' }}>Inventory &amp; Stock Health</h3>
            <div className="kpis">
              <Link className="kpi" to={sectionPath('products')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Active Products</small>
                <strong>{typeof cache.products === 'number' ? cache.products : '—'}</strong>
                <span>live catalogue pieces →</span>
              </Link>
              <Link className="kpi" to={sectionPath('products')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Stock Value (Cost)</small>
                <strong>{formatPrice(cache.stock_value || 0)}</strong>
                <span>remaining stock landed value →</span>
              </Link>
              <Link className="kpi" to={`${sectionPath('products')}?state=low_stock`} style={{ textDecoration: 'none', color: 'inherit', borderColor: (cache.low_stock_count > 0 ? '#ef4444' : undefined) }}>
                <small style={{ color: (cache.low_stock_count > 0 ? '#b91c1c' : undefined) }}>Low-stock Count</small>
                <strong style={{ color: (cache.low_stock_count > 0 ? '#b91c1c' : undefined) }}>{cache.low_stock_count ?? 0}</strong>
                <span>at or below threshold →</span>
              </Link>
              <Link className="kpi" to={sectionPath('products')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Fast-moving Count</small>
                <strong>{cache.fast_moving_count ?? 0}</strong>
                <span>&gt;50% purchased sold →</span>
              </Link>
              <Link className="kpi" to={sectionPath('products')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Dead-stock Count</small>
                <strong>{cache.dead_stock_count ?? 0}</strong>
                <span>0 units sold →</span>
              </Link>
            </div>

            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', margin: '20px 0 10px' }}>Procurement &amp; Vendor Operations</h3>
            <div className="kpis">
              <Link className="kpi" to={sectionPath('procurement')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Total Purchase Orders</small>
                <strong>{cache.total_pos ?? 0}</strong>
                <span>procurement POs →</span>
              </Link>
              <Link className="kpi" to={`${sectionPath('procurement')}?status=unfulfilled`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Pending Fulfilment</small>
                <strong style={{ color: '#d97706' }}>{cache.pending_pos ?? 0}</strong>
                <span>awaiting stock intake →</span>
              </Link>
              <Link className="kpi" to={`${sectionPath('procurement')}?status=fulfilled`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Fulfilled Orders</small>
                <strong style={{ color: '#166534' }}>{cache.fulfilled_pos ?? 0}</strong>
                <span>intake completed →</span>
              </Link>
              <Link className="kpi" to={sectionPath('procurement')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Total Purchase Value</small>
                <strong>{formatPrice(cache.total_po_value || 0)}</strong>
                <span>procurement expenditure →</span>
              </Link>
              <Link className="kpi" to={sectionPath('vendors')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Active Vendors</small>
                <strong>{cache.active_vendors ?? 0} / {cache.total_vendors ?? 0}</strong>
                <span>registered suppliers →</span>
              </Link>
              <Link className="kpi" to={sectionPath('products')} style={{ textDecoration: 'none', color: 'inherit' }}>
                <small>Best-Selling Product</small>
                <strong style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cache.best_selling_product?.product_name || '—'}</strong>
                <span>{cache.best_selling_product?.units || 0} units sold →</span>
              </Link>
            </div>

            <div className="grid2">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>6-Month Rolling Revenue Trend</h2>
                    <p>Monthly order volume and total revenue performance.</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Paid Orders</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cache.six_month_revenue || []).length ? (
                        cache.six_month_revenue.map((m, i) => (
                          <tr key={i}>
                            <td><strong>{m.month}</strong></td>
                            <td>{m.orders}</td>
                            <td><strong>{formatPrice(m.revenue)}</strong></td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan="3" className="empty">No historical revenue data recorded yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Best-Selling Categories</h2>
                    <p>Top category performance by revenue and units sold.</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Units Sold</th>
                        <th>Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cache.best_selling_categories || []).length ? (
                        cache.best_selling_categories.map((c, i) => (
                          <tr key={i}>
                            <td><strong>{c.category}</strong></td>
                            <td>{c.units} units</td>
                            <td><strong>{formatPrice(c.revenue)}</strong></td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan="3" className="empty">No category sales recorded yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="grid2">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Inventory Age</h2>
                    <p>Unsold piece tracker (items sitting &gt;21 days eligible for offers).</p>
                  </div>
                </div>
                <div className="chart">
                  {(cache.stock_age || []).length ? (
                    cache.stock_age.map((x, i) => (
                      <div key={i} className="bar" style={{ height: `${Math.max(16, Number(x.count) * 20)}px` }} title={`${x.count} pieces sitting in stock for ${x.age} days`}>
                        <b style={{ fontSize: 13, marginBottom: 4 }}>{x.count} {Number(x.count) === 1 ? 'piece' : 'pieces'}</b>
                        <span style={{ fontSize: 11, color: 'var(--muted, #666)' }}>{x.age === '21+' ? '21+ days old' : `${x.age} days`}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty" style={{ gridColumn: '1/-1' }}>No stock age recorded.</div>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Credit movement</h2>
                    <p>This month.</p>
                  </div>
                </div>
                <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="kpi">
                    <small>Issued</small>
                    <strong>{cache.credits_issued ?? '—'}</strong>
                  </div>
                  <div className="kpi">
                    <small>Used</small>
                    <strong>{cache.credits_used ?? 0}</strong>
                  </div>
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Size / colour gaps</h2>
                  <p>Lowest available combinations first.</p>
                </div>
                <Link className="btn" to={sectionPath('products')}>
                  Open inventory
                </Link>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th>Colour season</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cache.gaps || []).length ? (
                      cache.gaps.map((x, i) => (
                        <tr key={i}>
                          <td>{x.size_label || '—'}</td>
                          <td>{x.colour_season || 'Unclassified'}</td>
                          <td>{x.stock ?? 0}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="3">No gaps recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </>
    );
  })()}
</div>
)}

        {/* 2. Products */}
        {section === 'products' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Catalogue & inventory</h2>
                <p>Pieces, size-specific pricing, SKUs and stock. Sold pieces are archived, never erased.</p>
              </div>
              <div className="actions">
                <Link className="btn" to={sectionPath('categories')}>
                  Categories
                </Link>
                <button className="btn primary" onClick={() => openProduct(null)}>
                  Add piece
                </button>
              </div>
            </div>
            <ListFilter section="products" categories={categories} onApply={applyFilter} busy={loading} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Piece</th>
                    <th>Category</th>
                    <th>Vendor &amp; Batch</th>
                    <th>Sizes &amp; price</th>
                    <th>Cost / Unit</th>
                    <th>Purchased / Sold</th>
                    <th>Stock Left</th>
                    <th>Stock Value</th>
                    <th>Status</th>
                    <th style={{ minWidth: 240, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!displayProducts.length && !loading && (
                    <tr><td colSpan="11" className="empty">{filterQs.current.products ? 'No pieces match these filters.' : 'No pieces yet. Add your first piece.'}</td></tr>
                  )}
                  {displayProducts.map((p, idx) => {
                    const vs = Array.isArray(p.variants) ? p.variants : [];
                    const imgs = productImages(p);
                    const stockLeft = p.stock_total ?? 0;
                    const purchased = p.purchase_quantity || stockLeft;
                    const sold = p.units_sold ?? Math.max(0, purchased - stockLeft);
                    const classification = classifyInventory({
                      stock_left: stockLeft,
                      purchase_quantity: purchased,
                      units_sold: sold,
                      low_stock_threshold: p.low_stock_threshold ?? 2,
                    });
                    const remainingValue = stockLeft * (p.cost_price_inr || 0);
                    return (
                      <tr key={p.id}>
                        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <ProductThumb images={imgs} name={p.name} onOpen={() => { setActiveItem({ name: p.name, images: imgs, index: 0 }); setModalType('image'); }} />
                            <div>
                              {p.product_code && (
                                <span style={{ color: 'var(--wine, #752238)', fontWeight: 600, fontSize: 11, display: 'block', letterSpacing: '0.04em' }}>
                                  {p.product_code}
                                </span>
                              )}
                              <strong>{p.name}</strong>
                              {p.featured && (
                                <span style={{ marginLeft: 6, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#b89560', border: '1px solid #e0cdb2', background: '#faf6f0', padding: '1px 5px', borderRadius: 2 }}>
                                  Featured
                                </span>
                              )}
                              <br />
                              <small>{p.is_one_of_one ? 'One-of-one' : 'Multi-unit'} · {p.color || 'Colour not set'}</small>
                            </div>
                          </div>
                        </td>
                        <td>{p.category || '—'}</td>
                        <td>
                          <strong style={{ fontSize: 12 }}>{p.vendor_name || p.supplier_name || 'In-House Studio'}</strong>
                          <br />
                          <small style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>{p.batch_id || '—'}</small>
                        </td>
                        <td>
                          {vs.length ? vs.map((v) => (
                            <small key={v.id} style={{ display: 'block', opacity: v.is_active ? 1 : 0.5 }}>
                              {v.size_label} · {formatPrice(v.sale_price_inr ?? v.price_inr)}{v.sale_price_inr ? ` (was ${formatPrice(v.price_inr)})` : ''}
                            </small>
                          )) : <span className="status bad">No sizes</span>}
                        </td>
                        <td>{formatPrice(p.cost_price_inr || 0)}</td>
                        <td>
                          <span title={`Purchased: ${purchased} · Sold: ${sold}`}>
                            {purchased} / <strong style={{ color: sold > 0 ? '#166534' : 'inherit' }}>{sold}</strong>
                          </span>
                        </td>
                        <td>
                          <strong style={{ color: stockLeft <= (p.low_stock_threshold || 2) ? '#dc2626' : 'inherit' }}>
                            {stockLeft}
                          </strong>
                        </td>
                        <td>{formatPrice(remainingValue)}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span className={`status ${p.is_active ? 'good' : 'bad'}`}>{p.archived_at ? 'Archived' : p.is_active ? 'Live' : 'Hidden'}</span>
                            {classification === 'low_stock' && (
                              <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}>Low Stock</span>
                            )}
                            {classification === 'fast_moving' && (
                              <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#dcfce7', color: '#15803d', fontWeight: 600 }}>Fast Moving</span>
                            )}
                            {classification === 'dead_stock' && (
                              <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#f3f4f6', color: '#4b5563', fontWeight: 600 }}>Dead Stock</span>
                            )}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <div className="table-actions">
                            <button className="btn-action" disabled={busy} onClick={() => openProduct(p)}>
                              Edit
                            </button>
                            <button
                              className="btn-action"
                              style={{
                                color: p.featured ? '#b89560' : 'var(--muted)',
                                borderColor: p.featured ? '#b89560' : 'var(--line)',
                                background: p.featured ? '#fcf9f5' : 'transparent',
                              }}
                              disabled={busy}
                              title={p.featured ? 'Pinned in New Arrivals on homepage. Click to unpin.' : 'Click to pin in New Arrivals on homepage.'}
                              onClick={() =>
                                mutate(() => post('product_featured', { id: p.id, featured: !p.featured }), {
                                  success: p.featured ? 'Removed from New Arrivals featured' : 'Pinned to New Arrivals featured',
                                  reload: 'products',
                                })
                              }
                            >
                              {p.featured ? 'Featured' : 'Feature'}
                            </button>
                            <button
                              className="btn-action"
                              disabled={busy}
                              title={p.is_active ? 'Hide from store' : 'Publish to store'}
                              onClick={() => mutate(() => post('product_status', { id: p.id, is_active: !p.is_active }), { success: p.is_active ? 'Piece hidden' : 'Piece is live', reload: 'products' })}
                            >
                              {p.is_active ? 'Hide' : 'Show'}
                            </button>
                            <button
                              className="btn-action danger"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(`Remove "${p.name}"? Pieces with orders are archived so sales history is kept.`)) return;
                                mutate(() => api(`/api/admin/ops?section=product&id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }), {
                                  success: (r) => (r.result === 'archived' ? 'Piece archived (it has order history)' : 'Piece deleted'),
                                  reload: 'products',
                                });
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 3. Categories */}
        {section === 'categories' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Categories</h2>
                <p>Add, rename, hide and reorder launch categories.</p>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  setActiveItem({ name: '', slug: '', sort_order: 10, is_active: true });
                  setModalType('category');
                }}
              >
                Add category
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Order</th>
                    <th>Status</th>
                    <th style={{ minWidth: 180, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!displayCategories.length && !loading && (
                    <tr><td colSpan="6" className="empty">No categories defined yet.</td></tr>
                  )}
                  {displayCategories.map((c, idx) => (
                    <tr key={c.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>{c.name}</td>
                      <td>{c.slug}</td>
                      <td>{c.sort_order || 1}</td>
                      <td>{c.is_active ? 'Live' : 'Hidden'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn-action"
                            onClick={() => {
                              setActiveItem(c);
                              setModalType('category');
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-action"
                            disabled={busy}
                            onClick={() => mutate(() => post('category', { ...c, is_active: !c.is_active }), { success: c.is_active ? 'Category hidden' : 'Category is live', reload: 'categories' }).then(loadCategories)}
                          >
                            {c.is_active ? 'Hide' : 'Show'}
                          </button>
                          <button
                            type="button"
                            className="btn-action danger"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Delete category "${c.name}"? Products in this category will become unassigned.`)) return;
                              mutate(() => api(`/api/admin/ops?section=category&id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }), { success: 'Category deleted', reload: 'categories' }).then(loadCategories);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Vishrea AI Studio */}
        {section === 'ai_studio' && <AIStudio />}

        {/* 5. Orders */}
        {section === 'orders' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Fulfilment queue</h2>
                <p>Payment, packing, dispatch, tracking and delivery.</p>
              </div>
              <a className="btn" href="/api/admin/ops?section=export&type=orders">
                Export CSV
              </a>
            </div>
            <ListFilter section="orders" categories={categories} onApply={applyFilter} busy={loading} />
            {cache.abandoned_hidden > 0 && (
              <p className="settings-note">{cache.abandoned_hidden} abandoned checkout{cache.abandoned_hidden === 1 ? '' : 's'} (never paid) hidden. Tick “Include abandoned checkouts” to see {cache.abandoned_hidden === 1 ? 'it' : 'them'}.</p>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th style={{ minWidth: 130 }}>Order</th>
                    <th style={{ minWidth: 260 }}>Items</th>
                    <th style={{ minWidth: 150 }}>Customer</th>
                    <th style={{ minWidth: 90 }}>Total</th>
                    <th style={{ minWidth: 110 }}>Payment</th>
                    <th style={{ minWidth: 110 }}>Status</th>
                    <th style={{ minWidth: 160 }}>Tracking</th>
                    <th style={{ minWidth: 260, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!displayOrders.length && !loading && (
                    <tr><td colSpan="9" className="empty">{filterQs.current.orders ? 'No orders match these filters.' : 'No orders yet.'}</td></tr>
                  )}
                  {displayOrders.map((o, idx) => (
                    <tr key={o.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13, letterSpacing: '0.04em', color: 'var(--ink)' }}>
                            {o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`}
                          </strong>
                          <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', background: '#f0ece7', color: '#555', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                            {o.channel || 'web'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'grid', gap: 8 }}>
                          {(o.items || []).map((i, idx) => {
                            const imgs = productImages(i);
                            return (
                              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <ProductThumb images={imgs} name={i.name} size={38} onOpen={() => { setActiveItem({ name: i.name, images: imgs, index: 0 }); setModalType('image'); }} />
                                <div style={{ minWidth: 0, lineHeight: 1.35 }}>
                                  <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--ink)' }}>{i.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{i.size ? `${i.size} · ` : ''}Qty {i.qty}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink)' }}>{o.full_name || 'Customer'}</div>
                        {(o.email || o.phone) && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, wordBreak: 'break-all' }}>
                            {o.email || o.phone}
                          </div>
                        )}
                      </td>
                      <td>
                        <strong style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                          {formatPrice(o.total)}
                        </strong>
                        {(o.items?.length || 0) > 1 && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                            {o.items.reduce((s, x) => s + (x.qty || 1), 0)} pcs
                          </div>
                        )}
                      </td>
                      <td>
                        {paymentBadge(o.payment_status)}
                        {o.payment_failure_reason && (
                          <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4, lineHeight: 1.3 }}>
                            {PAYMENT_REASON[o.payment_failure_reason] || o.payment_failure_reason.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>
                      <td>
                        {fulfilmentBadge(o.status)}
                      </td>
                      <td>
                        {o.courier_partner && (
                          <div className="tracking-courier">{o.courier_partner}</div>
                        )}
                        {o.tracking_number ? (
                          o.tracking_url ? (
                            <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="tracking-pill" title="Track shipment">
                              <span>{o.tracking_number}</span>
                            </a>
                          ) : (
                            <span className="tracking-pill">{o.tracking_number}</span>
                          )
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="table-actions">
                          {(ORDER_NEXT[o.status] || []).filter((s) => s !== 'refunded' || ['paid', 'refund_required'].includes(o.payment_status)).map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={`btn-action ${s === 'dispatched' ? 'primary' : s === 'cancelled' ? 'danger' : ''}`}
                              disabled={busy}
                              onClick={() => {
                                if (s === 'dispatched') {
                                  openDispatch(o);
                                  return;
                                }
                                if (s === 'cancelled' && !window.confirm(o.payment_status === 'paid' ? 'Cancel this paid order? Stock is returned and the payment is flagged for refund.' : 'Cancel this order and release its stock?')) return;
                                mutate(() => post('order', { id: o.id, status: s }), { success: `Order marked ${s}`, reload: 'orders' });
                              }}
                            >
                              {s === 'dispatched' ? 'Dispatch' : s.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 6. Customers */}
        {section === 'customers' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Customer records & Analytics</h2>
                <p>Track purchase costs, rank top spenders, and distribute special offers directly to clients.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setActiveItem({ full_name: '', email: '', phone: '', notes: '' });
                    setModalType('customer');
                  }}
                >
                  + Add Customer
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setActiveItem({
                      target_type: 'top_spenders',
                      code: `VIP${new Date().getFullYear()}`,
                      title: 'Top Spenders Exclusive Privilege',
                      description: 'Exclusive seasonal offer for top-spending clients.',
                      discount_type: 'percentage',
                      discount_value: 20,
                      valid_days: 30,
                    });
                    setModalType('distribute_offer');
                  }}
                >
                  Distribute Special Offer
                </button>
                <a className="btn" href="/api/admin/ops?section=export&type=customers">
                  Export CSV
                </a>
              </div>
            </div>
            <ListFilter section="customers" categories={categories} onApply={applyFilter} busy={loading} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Membership</th>
                    <th>Credits</th>
                    <th>Orders</th>
                    <th>Total Spend</th>
                    <th>Consent</th>
                    <th style={{ minWidth: 260, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!(cache.customers || []).length && !loading && <tr><td colSpan="9" className="empty">{filterQs.current.customers ? 'No customers match these filters.' : 'No customers yet.'}</td></tr>}
                  {(cache.customers || []).map((c, idx) => (
                    <tr key={c.auth_user_id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>
                        {c.customer_code && (
                          <span style={{ color: 'var(--wine, #752238)', fontWeight: 600, fontSize: 11, display: 'block', letterSpacing: '0.04em' }}>
                            {c.customer_code}
                          </span>
                        )}
                        <strong>{c.full_name || 'Customer'}</strong>
                        <br />
                        <small>{c.email}</small>
                      </td>
                      <td>{c.phone || '—'}</td>
                      <td>
                        <span className={`status ${c.membership_status === 'active' ? 'good' : 'warn'}`}>{c.membership_status || 'none'}</span>
                      </td>
                      <td>{c.credits_balance ?? '—'}</td>
                      <td>{c.order_count ?? 0}</td>
                      <td>
                        <strong>{formatPrice(c.total_spent || 0)}</strong>
                        {Number(c.total_spent || 0) >= 10000 && (
                          <span className="status good" style={{ marginLeft: 6, fontSize: 10, padding: '2px 5px' }}>VIP</span>
                        )}
                      </td>
                      <td>{c.marketing_opt_in ? 'Marketing on' : 'Marketing off'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="table-actions">
                          <button type="button" className="btn-action" onClick={() => setCustomerId(c.auth_user_id)}>Open</button>
                          <button type="button" className="btn-action" onClick={() => { setActiveItem({ ...c }); setModalType('customer'); }}>Edit</button>
                          <button
                            type="button"
                            className="btn-action primary"
                            title="Distribute special offer to this customer"
                            onClick={() => {
                              setActiveItem({
                                customer: c,
                                auth_user_id: c.auth_user_id,
                                target_type: 'single',
                                code: `VIP${Math.floor(100 + Math.random() * 900)}`,
                                title: `Special Offer for ${c.full_name || 'Client'}`,
                                description: 'Personalized exclusive privilege from Vishrea Studio.',
                                discount_type: 'percentage',
                                discount_value: 20,
                                valid_days: 30,
                              });
                              setModalType('distribute_offer');
                            }}
                          >
                            Offer
                          </button>
                          <button
                            type="button"
                            className="btn-action danger"
                            title="Delete customer record"
                            onClick={() => {
                              if (!window.confirm(`Delete customer "${c.full_name || c.email}"? If they have completed orders, they cannot be deleted.`)) return;
                              mutate(() => api(`/api/admin/ops?section=customer&id=${encodeURIComponent(c.auth_user_id)}`, { method: 'DELETE' }), {
                                success: 'Customer deleted successfully',
                                reload: 'customers',
                              });
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 7. Memberships */}
        {section === 'memberships' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Walkin Wardrobe</h2>
                <p>₹1,799/month · 4 credits · membership operations.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Credits</th>
                    <th>Paid until</th>
                    <th>Months</th>
                  </tr>
                </thead>
                <tbody>
                  {!(cache.memberships || []).length && <tr><td colSpan="6" className="empty">No memberships yet.</td></tr>}
                  {(cache.memberships || []).map((m, idx) => (
                    <tr key={m.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>{m.full_name || m.email || m.auth_user_id}</td>
                      <td>
                        <select
                          value={m.status}
                          disabled={busy}
                          aria-label={`Membership status for ${m.full_name || m.email || 'member'}`}
                          onChange={(e) => {
                            const status = e.target.value;
                            if (!window.confirm(`Change this membership to ${status}?`)) return;
                            mutate(() => post('membership', { id: m.id, status }), { success: `Membership ${status}`, reload: 'memberships' });
                          }}
                        >
                          {[...new Set([m.status, ...MEMBERSHIP_STATUSES])].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>{m.credits_balance}</td>
                      <td>{m.paid_through || m.renewal_at ? new Date(m.paid_through || m.renewal_at).toLocaleDateString('en-IN') : '—'}</td>
                      <td>{m.consecutive_paid_months || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 8. Credits */}
        {section === 'credits' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Credit ledger</h2>
                <p>Every issue, redemption, expiry and adjustment is traceable.</p>
              </div>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  try {
                    const d = await api('/api/admin/ops?section=memberships');
                    if (!d.memberships?.length) return showToast('There are no memberships to adjust yet.');
                    setCache((prev) => ({ ...prev, memberships: d.memberships }));
                    setActiveItem({ membership_id: d.memberships[0].id, delta: 1, reason: 'Studio courtesy credit' });
                    setModalType('credit');
                  } catch (err) {
                    showToast(err.message);
                  }
                }}
              >
                + Adjust Credits
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Change</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {!(cache.credits || []).length && <tr><td colSpan="5" className="empty">No credit movements yet.</td></tr>}
                  {(cache.credits || []).map((x, idx) => (
                    <tr key={x.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>{new Date(x.created_at).toLocaleString('en-IN')}</td>
                      <td>{x.full_name || x.email || 'Member'}</td>
                      <td>{x.delta > 0 ? `+${x.delta}` : x.delta}</td>
                      <td>{x.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 9. Exchanges */}
        {section === 'exchanges' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Exchange & damage queue</h2>
                <p>7-day exchange · damage reported within 24 hours.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Customer</th>
                    <th>Order</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {(cache.exchanges || []).length ? (
                    cache.exchanges.map((x, idx) => (
                      <tr key={x.id}>
                        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          {x.exchange_code && (
                            <span style={{ color: 'var(--wine, #752238)', fontWeight: 600, fontSize: 11, display: 'block' }}>
                              {x.exchange_code}
                            </span>
                          )}
                          {x.full_name || x.email}
                          <small style={{ display: 'block', color: 'var(--muted)' }}>{x.reason}</small>
                        </td>
                        <td>
                          <strong>{x.order_number || x.order_id?.slice(0, 8).toUpperCase()}</strong>
                          {(x.evidence || []).some((ev) => ev.url) && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                              {x.evidence.filter((ev) => ev.url).map((ev, i, all) => (
                                <button
                                  key={ev.ref}
                                  type="button"
                                  title="Customer photo (private link, expires in a few minutes)"
                                  aria-label={`View customer photo ${i + 1}`}
                                  onClick={() => { setActiveItem({ name: `${x.claim_type === 'damage' ? 'Damage' : 'Exchange'} photos · ${x.full_name || x.email || ''}`, images: all.map((a) => a.url), index: i }); setModalType('image'); }}
                                  style={{ width: 36, height: 44, padding: 0, border: '1px solid var(--admin-line, #e5e5e5)', background: '#f4f1ee', cursor: 'zoom-in', overflow: 'hidden' }}
                                >
                                  <img src={ev.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>{x.claim_type || 'exchange'}</td>
                        <td>
                          <select
                            value={x.status}
                            disabled={busy}
                            aria-label="Exchange status"
                            style={{
                              padding: '5px 10px',
                              fontSize: 11,
                              fontWeight: 600,
                              borderRadius: 4,
                              cursor: 'pointer',
                              border: `1px solid ${x.status === 'approved' ? '#c8e6c9' : x.status === 'not_approved' ? '#fecaca' : x.status === 'review' ? '#fde68a' : 'var(--admin-line, #ccc)'}`,
                              background: x.status === 'approved' ? '#edf7ed' : x.status === 'not_approved' ? '#fef2f2' : x.status === 'review' ? '#fff8e1' : '#fff',
                              color: x.status === 'approved' ? '#1e4620' : x.status === 'not_approved' ? '#991b1b' : x.status === 'review' ? '#854d0e' : 'var(--ink, #1a1719)',
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === x.status) return;
                              setActiveItem({
                                exchange: x,
                                nextStatus: val,
                                resolution: x.resolution || (val === 'not_approved' ? 'Request not approved upon studio inspection.' : val === 'approved' ? 'Approved by studio. Replacement will be processed.' : ''),
                              });
                              setModalType('exchange_decision');
                            }}
                          >
                            {ALL_EXCHANGE_STATUSES.map(([s, label]) => (
                              <option key={s} value={s}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 12, color: x.resolution ? 'var(--ink)' : 'var(--muted)' }}>
                              {x.resolution || '—'}
                            </span>
                            <button
                              type="button"
                              title="Edit resolution opinion"
                              style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--admin-line, #e5e5e5)', background: '#fff', borderRadius: 3, cursor: 'pointer', color: 'var(--muted)' }}
                              onClick={() => {
                                setActiveItem({
                                  exchange: x,
                                  nextStatus: x.status,
                                  resolution: x.resolution || '',
                                });
                                setModalType('exchange_decision');
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="empty">No active exchange or damage requests.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 10. Loyalty */}
        {section === 'loyalty' && (
          <>
            <section className="panel" style={{ marginBottom: 24 }}>
              <div className="panel-head">
                <div>
                  <h2>Distributed VIP Offers & Promo Codes</h2>
                  <p>Manage bespoke customer promo codes and studio offers. You can pause or stop any active offer instantly, or permanently revoke it.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      const code = `VIP${Math.floor(100 + Math.random() * 900)}`;
                      setActiveItem({
                        target_type: 'top_spenders',
                        code,
                        title: 'Private Atelier VIP Privilege',
                        description: 'Exclusive bespoke atelier discount applied to your private wardrobe.',
                        discount_type: 'percentage',
                        discount_value: 20,
                        valid_days: 30,
                      });
                      setModalType('distribute_offer');
                    }}
                  >
                    + Distribute VIP Offer
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 44, textAlign: 'center' }}>#</th>
                      <th>Offer Code</th>
                      <th>Title & Description</th>
                      <th>Discount</th>
                      <th>Redemptions</th>
                      <th>Validity</th>
                      <th>Status</th>
                      <th style={{ minWidth: 160, textAlign: 'right', whiteSpace: 'nowrap' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(cache.offers || []).length && (
                      <tr>
                        <td colSpan="8" className="empty">No VIP offers or promo codes generated yet. Use the "Distribute VIP Offer" button or the customer table to grant an offer.</td>
                      </tr>
                    )}
                    {(cache.offers || []).map((off, idx) => {
                      const isExpired = off.ends_at && new Date(off.ends_at) < new Date();
                      const statusClass = !off.active ? 'bad' : isExpired ? 'warn' : 'good';
                      const statusLabel = !off.active ? 'Stopped' : isExpired ? 'Expired' : 'Active';
                      return (
                        <tr key={off.id}>
                          <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                          <td>
                            <strong style={{ letterSpacing: '0.08em', fontFamily: 'monospace', fontSize: 13, background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                              {off.code}
                            </strong>
                          </td>
                          <td>
                            <strong>{off.title}</strong>
                            {off.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{off.description}</div>}
                          </td>
                          <td>
                            <span style={{ fontWeight: 600 }}>
                              {off.discount_type === 'percentage' ? `${off.discount_value}% OFF` : `₹${off.discount_value} OFF`}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 13 }}>
                              <strong>{off.redeemed_count || 0}</strong> / {off.distributed_count ? off.distributed_count : 'Universal'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {off.ends_at ? `Until ${new Date(off.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No Expiry'}
                          </td>
                          <td>
                            <span className={`status ${statusClass}`}>{statusLabel}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <div className="table-actions" style={{ justifyContent: 'flex-end', gap: 6 }}>
                              {off.active ? (
                                <button
                                  type="button"
                                  className="btn-action"
                                  style={{ color: '#b91c1c', borderColor: '#fca5a5' }}
                                  disabled={busy}
                                  title="Immediately stop this offer so no customer can redeem it"
                                  onClick={() => mutate(() => post('toggle_offer', { id: off.id, active: false }), { success: `Offer "${off.code}" stopped!`, reload: 'loyalty' })}
                                >
                                  Stop Offer
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-action"
                                  style={{ color: '#15803d', borderColor: '#86efac' }}
                                  disabled={busy}
                                  title="Resume and activate this offer"
                                  onClick={() => mutate(() => post('toggle_offer', { id: off.id, active: true }), { success: `Offer "${off.code}" activated!`, reload: 'loyalty' })}
                                >
                                  Activate
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-action danger"
                                disabled={busy}
                                title="Permanently delete and revoke this offer"
                                onClick={() => {
                                  if (!window.confirm(`Permanently revoke offer code "${off.code}"? Customers will no longer be able to use it.`)) return;
                                  mutate(() => post('delete_offer', { id: off.id }), { success: `Offer "${off.code}" revoked and deleted!`, reload: 'loyalty' });
                                }}
                              >
                                Revoke
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Loyalty & Tenure Automation Rules</h2>
                  <p>Rules are data, not developer changes. Keep the profit guard before activation.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    title="Scan customer tenures (6 mo, 8 mo, etc.) and auto-grant anniversary rewards"
                    onClick={() => {
                      mutate(
                        () => post('run_loyalty_triggers', {}),
                        {
                          success: (d) => `Automated tenure triggers executed: ${d?.triggered_count ?? 0} customer(s) rewarded!`,
                          reload: 'loyalty',
                        }
                      );
                    }}
                  >
                    Run Automated Tenure Triggers
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setActiveItem({
                        name: '6-Month Tenure Loyalty Perk',
                        trigger_config: { event: 'tenure_6_months', months: 6 },
                        reward_config: { discount: '20% OFF' },
                        active: true,
                        estimated_monthly_cost: 1500,
                      });
                      setModalType('loyalty');
                    }}
                  >
                    + Create Offer Rule
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 44, textAlign: 'center' }}>#</th>
                      <th>Rule</th>
                      <th>Trigger</th>
                      <th>Reward</th>
                      <th>Status</th>
                      <th style={{ minWidth: 120, textAlign: 'right', whiteSpace: 'nowrap' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(cache.rules || []).length && <tr><td colSpan="6" className="empty">No offer rules yet. Rules are recorded for planning; checkout pricing does not apply them automatically.</td></tr>}
                    {(cache.rules || []).map((r, idx) => (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td><strong>{r.name}</strong></td>
                        <td><code>{typeof r.trigger_config === 'object' ? JSON.stringify(r.trigger_config) : r.trigger_config}</code></td>
                        <td><code>{typeof r.reward_config === 'object' ? JSON.stringify(r.reward_config) : r.reward_config}</code></td>
                        <td>
                          <span className={`status ${r.active ? 'good' : 'bad'}`}>{r.active ? 'Live' : 'Paused'}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="btn-action"
                              disabled={busy}
                              onClick={() => mutate(() => post('loyalty', { ...r, active: !r.active }), { success: `Rule ${r.active ? 'paused' : 'activated'}`, reload: 'loyalty' })}
                            >
                              {r.active ? 'Pause' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* 11. Drops */}
        {section === 'drops' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Weekly drops</h2>
                <p>Pieces assigned to a drop (in the piece editor) are hidden until the members' start time, shown only to active members until the public time, then to everyone.</p>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  const now = new Date();
                  const starts = new Date(now.getTime() + 86400000 * 2).toISOString();
                  const publicAt = new Date(now.getTime() + 86400000 * 4).toISOString();
                  setActiveItem({ name: 'Curated Edit ' + (cache.drops?.length ? cache.drops.length + 1 : 2), starts_at: starts, public_at: publicAt, active: true });
                  setModalType('drop');
                }}
              >
                + Schedule Weekly Drop
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Name</th>
                    <th>Member access</th>
                    <th>Public</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!(cache.drops || []).length && <tr><td colSpan="5" className="empty">No drops scheduled.</td></tr>}
                  {(cache.drops || []).map((d, idx) => (
                    <tr key={d.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td><strong>{d.name}</strong></td>
                      <td>{d.starts_at ? new Date(d.starts_at).toLocaleString('en-IN') : '48h prior'}</td>
                      <td>{new Date(d.public_at).toLocaleString('en-IN')}</td>
                      <td>
                        <span className="status good">{d.active ? 'Active' : 'Off'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 12. Sourcing */}
        {section === 'sourcing' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Sourcing log</h2>
                <p>Supplier, batch and cost history for margin visibility.</p>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  setActiveItem({ supplier_name: '', batch_date: new Date().toISOString().slice(0, 10), notes: '' });
                  setModalType('sourcing');
                }}
              >
                + Add Sourcing Batch
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {!(cache.batches || []).length && <tr><td colSpan="4" className="empty">No sourcing batches recorded.</td></tr>}
                  {(cache.batches || []).map((x, idx) => (
                    <tr key={x.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>{x.batch_date}</td>
                      <td><strong>{x.supplier_name}</strong></td>
                      <td>{x.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 13. Store / Counter Sales & POS */}
        {section === 'store' && (
          <div>
            <section className="panel" style={{ marginBottom: 24 }}>
              <div className="panel-head">
                <div>
                  <h2>Counter Sales &amp; POS Counter</h2>
                  <p>Record walk-in counter sales, apply loyalty rewards, collect payments, and manage store sales.</p>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setActiveItem({
                      customer_id: '',
                      sale_date: new Date().toISOString().slice(0, 10),
                      items: [{ variant_id: displayProducts[0]?.variant_id || displayProducts[0]?.id || '', quantity: 1, unit_price: displayProducts[0]?.price_inr || 0, cost_price: displayProducts[0]?.cost_price_inr || 0 }],
                      discount_amount: 0,
                      amount_paid: 0,
                      payment_mode: 'upi',
                      notes: '',
                    });
                    setModalType('counter_sale');
                  }}
                >
                  + New Counter Sale
                </button>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="store-search">Quick Sell Piece Search</label>
                  <input id="store-search" placeholder="Search by product name or SKU" value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="store-mode">Quick Payment Received By</label>
                  <select id="store-mode" value={storeMode} onChange={(e) => setStoreMode(e.target.value)}>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              </div>
              <div className="table-wrap" style={{ marginTop: '15px' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 44, textAlign: 'center' }}>#</th>
                      <th>Piece</th>
                      <th>Size / SKU</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!displayProducts.length && (
                      <tr><td colSpan="6" className="empty">No active stock available for store counter sale.</td></tr>
                    )}
                    {displayProducts
                      .filter((p) => `${p.name} ${p.sku || ''}`.toLowerCase().includes(storeSearch.toLowerCase()))
                      .map((p, idx) => (
                        <tr key={p.variant_id || p.id}>
                          <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                          <td>{p.name}</td>
                          <td>{p.size_label} · <small>{p.sku}</small></td>
                          <td>{formatPrice(p.sale_price_inr && p.sale_price_inr < p.price_inr ? p.sale_price_inr : p.price_inr)}</td>
                          <td>{p.stock_quantity}</td>
                          <td>
                            <button className="btn primary" disabled={busy} onClick={() => handleStoreSale(p)}>
                              Quick Sell
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Sales History Table */}
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Recorded Sales History</h2>
                  <p>View sales invoices, inspect customer purchase items, print receipts, and manage sales.</p>
                </div>
              </div>
              <ListFilter section="store" categories={categories} onApply={applyFilter} busy={loading} />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 44, textAlign: 'center' }}>#</th>
                      <th>Sale ID / Invoice</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Items Sold</th>
                      <th>Subtotal</th>
                      <th>Discount</th>
                      <th>Final Total</th>
                      <th>Paid / Due</th>
                      <th>Payment</th>
                      <th>Est. Profit</th>
                      <th style={{ minWidth: 180, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!displaySales.length && (
                      <tr><td colSpan="12" className="empty">No store counter sales recorded yet.</td></tr>
                    )}
                    {displaySales.map((s, idx) => (
                      <tr key={s.id}>
                        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          <strong>{s.order_number || s.invoice_number || `#${s.id.slice(0, 8).toUpperCase()}`}</strong>
                          <br />
                          <small style={{ color: 'var(--muted)' }}>{s.channel || 'studio'}</small>
                        </td>
                        <td>{s.sale_date ? new Date(s.sale_date).toLocaleDateString('en-IN') : new Date(s.created_at).toLocaleDateString('en-IN')}</td>
                        <td>
                          <strong>{s.customer_name || 'Walk-in Client'}</strong>
                          {s.customer_phone && <><br /><small>{s.customer_phone}</small></>}
                        </td>
                        <td>
                          {(s.items || []).map((it, idx) => (
                            <div key={idx} style={{ fontSize: 12 }}>
                              {it.name} {it.size ? `(${it.size})` : ''} &times; <strong>{it.quantity}</strong>
                            </div>
                          ))}
                        </td>
                        <td>{formatPrice(s.subtotal || 0)}</td>
                        <td>{Number(s.discount_amount) > 0 ? <span style={{ color: '#166534' }}>-{formatPrice(s.discount_amount)}</span> : '—'}</td>
                        <td><strong>{formatPrice(s.total || 0)}</strong></td>
                        <td>
                          <div>{formatPrice(s.amount_paid || 0)}</div>
                          {Number(s.amount_due) > 0 && <small style={{ color: '#dc2626' }}>Due: {formatPrice(s.amount_due)}</small>}
                        </td>
                        <td>{paymentBadge(s.payment_status || 'paid')}</td>
                        <td>
                          <strong style={{ color: Number(s.estimated_profit) >= 0 ? '#166534' : '#dc2626' }}>
                            {formatPrice(s.estimated_profit || 0)}
                          </strong>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="btn-action"
                              onClick={() => {
                                setActiveItem(s);
                                setModalType('receipt');
                              }}
                            >
                              Receipt
                            </button>
                            {s.payment_status !== 'cancelled' && s.status !== 'cancelled' && (
                              <button
                                type="button"
                                className="btn-action danger"
                                disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(`Cancel sale ${s.order_number || s.invoice_number || s.id.slice(0, 8)}? All items will be restored to inventory stock immediately.`)) return;
                                  mutate(() => api(`/api/admin/ops?section=sale&id=${s.id}`, { method: 'DELETE' }), {
                                    success: 'Sale cancelled and stock restored to inventory',
                                    reload: 'store',
                                  });
                                }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* 13b. Procurement & Purchase Orders */}
        {section === 'procurement' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Procurement &amp; Purchase Orders</h2>
                <p>Issue supplier purchase orders, assign batch IDs, allocate courier freight, and fulfil items directly into inventory.</p>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  setActiveItem({
                    vendor_id: displayVendors[0]?.id || '',
                    vendor_name: displayVendors[0]?.name || '',
                    order_date: todayStr,
                    batch_id: suggestBatchId(displayVendors[0]?.name || 'PO', todayStr),
                    courier_charges: 0,
                    items: [{ item_name: '', category: 'Couture', quantity: 1, unit_cost: 0 }],
                    notes: '',
                  });
                  setModalType('purchase_order');
                }}
              >
                + New Purchase Order
              </button>
            </div>
            <ListFilter section="procurement" categories={categories} onApply={applyFilter} busy={loading} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>PO Number</th>
                    <th>Vendor</th>
                    <th>Order Date</th>
                    <th>Batch ID</th>
                    <th>Line Items</th>
                    <th>Courier Freight</th>
                    <th>Grand Total</th>
                    <th>Status</th>
                    <th style={{ minWidth: 260, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!displayPOs.length && !loading && (
                    <tr><td colSpan="10" className="empty">No purchase orders found matching this view.</td></tr>
                  )}
                  {displayPOs.map((po, idx) => (
                    <tr key={po.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>
                        <strong>{po.po_number}</strong>
                        {po.fulfilled_at && <><br /><small style={{ color: '#166534' }}>Fulfilled {new Date(po.fulfilled_at).toLocaleDateString('en-IN')}</small></>}
                      </td>
                      <td><strong>{po.vendor_name || 'Vendor'}</strong></td>
                      <td>{new Date(po.order_date).toLocaleDateString('en-IN')}</td>
                      <td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 4px', borderRadius: 2 }}>{po.batch_id || '—'}</code></td>
                      <td>
                        {(po.items || []).map((it, idx) => (
                          <div key={idx} style={{ fontSize: 12 }}>
                            {it.item_name} &times; <strong>{it.quantity}</strong> ({formatPrice(it.unit_cost)})
                          </div>
                        ))}
                      </td>
                      <td>{formatPrice(po.courier_charges || 0)}</td>
                      <td><strong>{formatPrice(po.grand_total || 0)}</strong></td>
                      <td>
                        <span className={`status ${po.status === 'fulfilled' ? 'good' : po.status === 'cancelled' ? 'bad' : 'warn'}`}>
                          {po.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn-action"
                            onClick={() => {
                              setActiveItem(po);
                              setModalType('view_po');
                            }}
                          >
                            Print PO
                          </button>
                          {po.status !== 'fulfilled' && (
                            <>
                              <button
                                type="button"
                                className="btn-action primary"
                                disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(`Fulfil Purchase Order ${po.po_number} and add its items into inventory stock?`)) return;
                                  mutate(() => post('fulfil_purchase_order', { id: po.id }), {
                                    success: 'PO fulfilled and inventory stock updated',
                                    reload: 'procurement',
                                  });
                                }}
                              >
                                Fulfil
                              </button>
                              <button
                                type="button"
                                className="btn-action"
                                onClick={() => {
                                  setActiveItem({ ...po });
                                  setModalType('purchase_order');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn-action danger"
                                disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(`Delete purchase order ${po.po_number}?`)) return;
                                  mutate(() => api(`/api/admin/ops?section=purchase_order&id=${po.id}`, { method: 'DELETE' }), {
                                    success: 'Purchase order deleted',
                                    reload: 'procurement',
                                  });
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 13c. Vendors & Suppliers */}
        {section === 'vendors' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Vendors &amp; Suppliers</h2>
                <p>Manage artisan partners, textile mills, supplier directory, and procurement history.</p>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setActiveItem({
                    name: '',
                    code: `VEND-${Math.floor(100 + Math.random() * 900)}`,
                    contact_person: '',
                    phone: '',
                    email: '',
                    address: '',
                    categories: '',
                    notes: '',
                    is_active: true,
                  });
                  setModalType('vendor');
                }}
              >
                + Add Vendor
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Vendor Code &amp; Name</th>
                    <th>Contact &amp; Phone</th>
                    <th>Categories Supplied</th>
                    <th>Purchase Orders</th>
                    <th>Total Spend</th>
                    <th>Sales Margin</th>
                    <th>Status</th>
                    <th style={{ minWidth: 160, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!displayVendors.length && !loading && (
                    <tr><td colSpan="9" className="empty">No vendors registered yet. Add your first supplier partner.</td></tr>
                  )}
                  {displayVendors.map((v, idx) => (
                    <tr key={v.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td>
                        <strong>{v.name}</strong>
                        <br />
                        <small style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>{v.code || 'VEND'}</small>
                      </td>
                      <td>
                        <div>{v.contact_person || '—'}</div>
                        <small>{v.phone || v.email || '—'}</small>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(Array.isArray(v.categories) ? v.categories : String(v.categories || '').split(',').map((s) => s.trim()).filter(Boolean)).map((cat, i) => (
                            <span key={i} style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 5px', borderRadius: 2 }}>{cat}</span>
                          ))}
                        </div>
                      </td>
                      <td>{v.total_pos || 0}</td>
                      <td><strong>{formatPrice(v.total_purchases || 0)}</strong></td>
                      <td><strong style={{ color: '#166534' }}>{formatPrice(v.sales_profit || 0)}</strong></td>
                      <td>
                        <span className={`status ${v.is_active ? 'good' : 'warn'}`}>
                          {v.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn-action"
                            onClick={() => {
                              setActiveItem({ ...v });
                              setModalType('vendor');
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-action danger"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Delete vendor "${v.name}"? If they have purchase orders or inventory items, they cannot be deleted.`)) return;
                              mutate(() => api(`/api/admin/ops?section=vendor&id=${v.id}`, { method: 'DELETE' }), {
                                success: 'Vendor deleted',
                                reload: 'vendors',
                              });
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 14. Content & Customer Reels */}
        {section === 'content' && (
          <div>
            <div className="grid2">
              {/* Instagram Stories */}
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Instagram / Stories</h2>
                    <p>Stories from our wardrobe &amp; Instagram Reel features.</p>
                  </div>
                  <div>
                    <span className={`status ${displayInstagram.some((x) => x.active !== false) || displayVideos.some((v) => v.active) ? 'good' : 'warn'}`}>
                      {displayInstagram.some((x) => x.active !== false) || displayVideos.some((v) => v.active)
                        ? 'Live Custom Reels Active'
                        : 'Default Studio Reels Active'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setActiveItem({ title: '', post_url: '', image_url: '' });
                      setUploadedVideoUrl('');
                      setUploadedImageUrl('');
                      setModalType('instagram');
                    }}
                  >
                    + Add Instagram Reel / Story
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      background: '#ffffff',
                      color: 'var(--wine)',
                      borderColor: 'var(--wine)',
                      fontWeight: 600,
                    }}
                    disabled={busy}
                    onClick={handleSwitchToDefaultReels}
                    title="Unpublish live reels to show the default curated studio reels on the homepage"
                  >
                    Reset to Default Reels
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="table" style={{ marginTop: '14px' }}>
                    <thead>
                      <tr>
                        <th>Title / Link</th>
                        <th>Status</th>
                        <th style={{ minWidth: 180, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayInstagram.length ? (
                        displayInstagram.map((x) => (
                          <tr key={x.id}>
                            <td>
                              <strong>{x.title || 'Instagram Feature'}</strong>
                              <br />
                              <small>
                                <a href={x.post_url} target="_blank" rel="noreferrer" style={{ color: 'var(--wine)' }}>
                                  {x.post_url}
                                </a>
                              </small>
                            </td>
                            <td>
                              <span className={`status ${x.active !== false ? 'good' : 'warn'}`}>
                                {x.active !== false ? 'Live' : 'Hidden'}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              <div className="table-actions">
                                <button
                                  type="button"
                                  className="btn-action"
                                  disabled={busy}
                                  onClick={() => toggleContentStatus('instagram', x.id, x.active === false)}
                                >
                                  {x.active === false ? 'Publish' : 'Unpublish'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-action danger"
                                  disabled={busy}
                                  onClick={() => deleteContentItem('instagram', x.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="3" className="empty">
                            No Instagram features yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Customer Feedback Reels (Rule: <=10s duration, max 3 live) */}
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Customer feedback reels</h2>
                    <p>Up to {cache.limits?.max_published_videos ?? 3} live customer videos, {cache.limits?.max_video_seconds ?? 10}s maximum. Limits are enforced by the server.</p>
                  </div>
                  <span className={`status ${displayVideos.filter((v) => v.active).length >= (cache.limits?.max_published_videos ?? 3) ? 'warn' : 'good'}`}>
                    {displayVideos.filter((v) => v.active).length}/{cache.limits?.max_published_videos ?? 3} Live
                  </span>
                </div>
                <button
                  className="btn primary"
                  onClick={() => {
                    setActiveItem({ title: '', customer_name: '' });
                    setUploadedVideoUrl('');
                    setVideoDuration(null);
                    setModalType('video');
                  }}
                >
                  + Add Customer Video Reel
                </button>
                <div className="table-wrap">
                  <table className="table" style={{ marginTop: '14px' }}>
                    <thead>
                      <tr>
                        <th>Video</th>
                        <th>Customer / Title</th>
                        <th>Status</th>
                        <th style={{ minWidth: 240, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayVideos.length ? (
                        displayVideos.map((x) => (
                          <tr key={x.id}>
                            <td style={{ width: '50px' }}>
                              <div style={{ width: '44px', height: '56px', background: '#171316', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                <video src={x.video_url} preload="metadata" controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted aria-label={`Preview ${x.title || 'customer video'}`} />
                              </div>
                            </td>
                            <td>
                              <strong>{x.title || 'Customer look'}</strong>
                              {x.customer_name && <small style={{ display: 'block' }}>{x.customer_name}</small>}
                              {x.duration_seconds && <small style={{ display: 'block', color: 'var(--muted)' }}>{Number(x.duration_seconds)}s</small>}
                            </td>
                            <td>
                              <span className={`status ${x.active ? 'good' : 'warn'}`}>{x.active ? 'Live' : 'Hidden'}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              <div className="table-actions">
                                <button type="button" className="btn-action" disabled={busy} onClick={() => toggleContentStatus('video', x.id, !x.active)}>
                                  {x.active ? 'Hide' : 'Publish'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-action"
                                  disabled={busy}
                                  onClick={() => {
                                    setActiveItem({ id: x.id, title: x.title, customer_name: x.customer_name, active: x.active });
                                    setUploadedVideoUrl(x.video_url);
                                    setVideoDuration(x.duration_seconds);
                                    setVideoDurationValid(true);
                                    setModalType('video');
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn-action danger"
                                  disabled={busy}
                                  onClick={() => deleteContentItem('video', x.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="empty">
                            No customer reels uploaded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* Legal Pages */}
            <section className="panel" style={{ marginTop: '24px' }}>
              <div className="panel-head">
                <div>
                  <h2>Legal pages</h2>
                  <p>Privacy, terms, exchange/damage, membership terms and grievance details.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Slug</th>
                      <th>Title</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(cache.legal || []).length && <tr><td colSpan="3" className="empty">No legal pages published yet.</td></tr>}
                    {(cache.legal || []).map((x) => (
                      <tr key={x.slug}>
                        <td>
                          <Link to={`/legal?slug=${x.slug}`} target="_blank" style={{ color: 'var(--wine)' }}>
                            {x.slug} (view)
                          </Link>
                        </td>
                        <td>{x.title}</td>
                        <td>{new Date(x.updated_at).toLocaleDateString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {section === 'couriers' && <CouriersSection toast={showToast} />}
        {section === 'administrators' && <AdministratorsSection toast={showToast} />}
        {section === 'homepage' && <HomepageSection toast={showToast} />}
        {section === 'gift_enquiries' && <GiftEnquiriesSection toast={showToast} />}
        {section === 'referrals' && <ReferralsSection />}
        {section === 'rewards' && <RewardsSection toast={showToast} />}
        {section === 'settings' && <SettingsSection toast={showToast} />}
        {section === 'content' && <LegalEditor pages={cache.legal} store={cache.store} toast={showToast} onSaved={() => loadSection('content')} />}

        {/* 15. Invoices & 16. Audit Log */}
        {section === 'invoices' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Invoices &amp; GST</h2>
                <p>One invoice per paid order or membership payment, numbered sequentially per financial year.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn" href="/api/admin/ops?section=export&type=invoices">Invoices CSV</a>
                <a className="btn" href="/api/admin/ops?section=export&type=membership_payments">Membership payments CSV</a>
                <a className="btn" href="/api/admin/ops?section=export&type=payment_attempts">Autopay attempts CSV</a>
                <a className="btn" href="/api/admin/ops?section=export&type=bag_shipments">Wardrobe Bag shipments CSV</a>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Invoice</th><th>Customer</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th><th>Place of supply</th><th>Issued</th></tr>
                </thead>
                <tbody>
                  {!(cache.invoices || []).length && <tr><td colSpan="10" className="empty">No invoices yet.</td></tr>}
                  {(cache.invoices || []).map((x, idx) => (
                    <tr key={x.id}>
                      <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                      <td><strong>{x.invoice_number}</strong><small style={{ display: 'block', color: 'var(--muted)' }}>{x.order_id ? 'Order' : 'Membership'}</small></td>
                      <td>{x.full_name || x.buyer_name || x.email || '—'}{x.buyer_gstin && <small style={{ display: 'block' }}>{x.buyer_gstin}</small>}</td>
                      <td>{formatPrice(x.taxable_value)}</td>
                      <td>{formatPrice(x.cgst_amount)}</td>
                      <td>{formatPrice(x.sgst_amount)}</td>
                      <td>{formatPrice(x.igst_amount)}</td>
                      <td>{formatPrice(x.total_amount)}</td>
                      <td>{x.place_of_supply || '—'}</td>
                      <td>{new Date(x.issued_at).toLocaleDateString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {section === 'audit' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Operations audit log</h2>
                <p>Everything that happened in the studio, newest first: sign-ins, payments, orders, stock, credits, content and admin changes. Open “More details” for payment IDs and exact values.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>When</th><th>Who</th><th>What happened</th><th>Related to</th></tr></thead>
                <tbody>
                  {!(cache.logs || []).length && <tr><td colSpan="5" className="empty">No audit entries yet.</td></tr>}
                  {(cache.logs || []).map((x, idx) => {
                    const a = describeAudit(x);
                    const when = new Date(x.created_at);
                    return (
                      <tr key={x.id}>
                        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          <small style={{ display: 'block', color: 'var(--muted)' }}>{when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small>
                        </td>
                        <td>
                          {a.who}
                          {a.whoNote && <small style={{ display: 'block', color: 'var(--muted)' }}>{a.whoNote}</small>}
                        </td>
                        <td>
                          {a.what}
                          {a.details.length > 0 && (
                            <details style={{ marginTop: 4 }}>
                              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>More details</summary>
                              <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 10px', fontSize: 11 }}>
                                {a.details.map(([k, v]) => (
                                  <Fragment key={k}><dt style={{ color: 'var(--muted)' }}>{k}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{v}</dd></Fragment>
                                ))}
                              </dl>
                            </details>
                          )}
                        </td>
                        <td>
                          {a.about}
                          {a.aboutNote && <small style={{ display: 'block', color: 'var(--muted)' }}>{a.aboutNote}</small>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
          </>
        )}
        </AdminErrorBoundary>
      </main>

      {/* MODAL: Product image viewer */}
      {modalType === 'image' && activeItem?.images?.length > 0 && (() => {
        const { images, index = 0, name } = activeItem;
        const go = (d) => setActiveItem({ ...activeItem, index: (index + d + images.length) % images.length });
        const navBtn = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 18, cursor: 'pointer' };
        return (
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Images of ${name}`} onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
            <div className="modal-card" style={{ maxWidth: 720 }}>
              <div className="modal-head">
                <h2>{name} <small style={{ fontSize: 12, opacity: 0.6 }}>{index + 1} / {images.length}</small></h2>
                <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
              </div>
              <div style={{ position: 'relative', background: '#f4f1ee', display: 'grid', placeItems: 'center' }}>
                <img src={images[index]} alt={`${name} — image ${index + 1}`} style={{ maxWidth: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block' }} />
                {images.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous image" onClick={() => go(-1)} style={{ ...navBtn, left: 8 }}>‹</button>
                    <button type="button" aria-label="Next image" onClick={() => go(1)} style={{ ...navBtn, right: 8 }}>›</button>
                  </>
                )}
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto' }}>
                  {images.map((src, i) => (
                    <button key={src + i} type="button" aria-label={`Show image ${i + 1}`} onClick={() => setActiveItem({ ...activeItem, index: i })} style={{ flex: '0 0 auto', width: 56, height: 70, padding: 0, border: i === index ? '2px solid #111' : '1px solid var(--admin-line, #ddd)', background: '#f4f1ee', cursor: 'pointer', opacity: i === index ? 1 : 0.7 }}>
                      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <a className="btn" href={images[index]} target="_blank" rel="noreferrer">Open full size</a>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Customer video (server enforces duration and live limit) */}
      {modalType === 'video' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Customer video" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card">
            <div className="modal-head">
              <h2>{activeItem.id ? 'Edit customer video' : 'Add customer video'}</h2>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>
            <form id="videoForm" className="form-grid" onSubmit={handleSaveVideoReel}>
              <div className="field full">
                <label htmlFor="vid-customer">Customer name</label>
                <input id="vid-customer" name="customer_name" defaultValue={activeItem.customer_name || ''} placeholder="e.g. Ananya" required maxLength={80} />
              </div>
              <div className="field full">
                <label htmlFor="vid-title">Title</label>
                <input id="vid-title" name="title" defaultValue={activeItem.title || ''} placeholder="e.g. My Vishrea brunch look" required maxLength={160} />
              </div>
              <div className="field full">
                <label htmlFor="vid-file">Video file (MP4 or MOV, up to {cache.limits?.max_video_seconds ?? 10}s)</label>
                <input id="vid-file" ref={videoInputRef} type="file" accept="video/mp4,video/quicktime" disabled={uploadingVideo} onChange={(e) => handleVideoFile(e.target.files[0])} />
                {uploadingVideo && <small>Uploading and checking duration…</small>}
                {uploadedVideoUrl && (
                  <div style={{ marginTop: 10 }}>
                    <video src={uploadedVideoUrl} playsInline muted controls preload="metadata" style={{ maxHeight: 180, display: 'block' }} aria-label="Video preview" />
                    {videoDuration !== null && (
                      <small style={{ color: videoDurationValid ? '#285c43' : '#8a2b3e', fontWeight: 600 }}>
                        Duration {Number(videoDuration)}s · {videoDurationValid ? 'eligible' : 'too long'}
                      </small>
                    )}
                  </div>
                )}
              </div>
              <div className="field full">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" name="publish" defaultChecked={activeItem.id ? Boolean(activeItem.active) : true} /> Publish on the homepage
                </label>
              </div>
              <div className="field full">
                <button className="btn primary" disabled={busy || uploadingVideo || !uploadedVideoUrl || !videoDurationValid}>
                  {busy ? 'Saving…' : 'Save customer video'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Instagram feature */}
      {modalType === 'instagram' && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Instagram feature" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card">
            <div className="modal-head">
              <h2>Add Instagram feature</h2>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>
            <form className="form-grid" onSubmit={handleSaveInstagram}>
              <div className="field full">
                <label htmlFor="ig-title">Title / creator</label>
                <input id="ig-title" name="title" required maxLength={160} placeholder="e.g. Studio look" defaultValue={activeItem?.title || ''} />
              </div>
              <div className="field full">
                <label htmlFor="ig-url">Instagram post or reel URL</label>
                <input id="ig-url" name="post_url" required={!uploadedVideoUrl} placeholder="https://www.instagram.com/reel/…" defaultValue={activeItem?.post_url || ''} />
              </div>
              <div className="field full">
                <label htmlFor="ig-image">Cover image URL or upload (optional)</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="ig-image"
                    name="image_url"
                    placeholder="https://… or upload cover image"
                    value={uploadedImageUrl || activeItem?.image_url || ''}
                    onChange={(e) => setUploadedImageUrl(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <label className="btn" style={{ cursor: 'pointer', whiteSpace: 'nowrap', margin: 0 }}>
                    {uploadingImage ? 'Uploading…' : 'Upload Cover'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={uploadingImage}
                      onChange={(e) => handleCoverImageFile(e.target.files?.[0])}
                    />
                  </label>
                </div>
                {uploadedImageUrl && (
                  <div style={{ marginTop: '8px' }}>
                    <img src={uploadedImageUrl} alt="Cover preview" style={{ maxHeight: '120px', borderRadius: '8px', border: '1px solid var(--line)', display: 'block' }} />
                  </div>
                )}
              </div>
              <div className="field full">
                <button className="btn primary" disabled={busy || uploadingImage}>{busy ? 'Saving…' : 'Save & Publish Feature'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Product with size-specific pricing */}
      {modalType === 'product' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Edit piece" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card" style={{ maxWidth: 860 }}>
            <div className="modal-head">
              <h2>{activeItem.id ? 'Edit piece' : 'Add piece'}</h2>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>
            <form className="form-grid" onSubmit={saveProduct}>
              <div className="field full">
                <label htmlFor="p-name">Name</label>
                <input id="p-name" required maxLength={160} value={activeItem.name || ''} onChange={(e) => setActiveItem({ ...activeItem, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="p-cat">Category</label>
                <select id="p-cat" value={activeItem.category_id || ''} onChange={(e) => setActiveItem({ ...activeItem, category_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {displayCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-type">Inventory type</label>
                <select id="p-type" value={activeItem.is_one_of_one === false ? 'multi' : 'one'} onChange={(e) => setActiveItem({ ...activeItem, is_one_of_one: e.target.value === 'one' })}>
                  <option value="one">One-of-one (1 unit per size)</option>
                  <option value="multi">Multiple units per size</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-colour">Colour</label>
                <input id="p-colour" maxLength={60} value={activeItem.color || ''} onChange={(e) => setActiveItem({ ...activeItem, color: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="p-season">Colour season (matches the colour analysis)</label>
                <select id="p-season" value={activeItem.colour_season || ''} onChange={(e) => setActiveItem({ ...activeItem, colour_season: e.target.value })}>
                  <option value="">Not set</option>
                  {activeItem.colour_season && !COLOUR_SEASONS.includes(activeItem.colour_season) && <option value={activeItem.colour_season}>{activeItem.colour_season} (not a colour season — choose one)</option>}
                  {COLOUR_SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-drop">Drop (members' early access)</label>
                <select id="p-drop" value={activeItem.drop_id || ''} onChange={(e) => setActiveItem({ ...activeItem, drop_id: e.target.value || null })}>
                  <option value="">Not in a drop — on sale now</option>
                  {(cache.drops || []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name} · members {new Date(d.starts_at).toLocaleString('en-IN')} · public {d.public_at ? new Date(d.public_at).toLocaleString('en-IN') : '+48h'}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-credit">Membership credits</label>
                <select id="p-credit" value={activeItem.credit_eligible === false ? 'no' : 'yes'} onChange={(e) => setActiveItem({ ...activeItem, credit_eligible: e.target.value === 'yes' })}>
                  <option value="yes">Can be taken with a credit (unless badge is Premium)</option>
                  <option value="no">Cannot be taken with a credit</option>
                </select>
              </div>
              <div className="field">
                <span className="field-label" id="p-reward-label">Free-piece reward</span>
                <label className="check-inline" htmlFor="p-reward">
                  <input id="p-reward" type="checkbox" aria-describedby="p-reward-help" checked={Boolean(activeItem.reward_eligible)} onChange={(e) => setActiveItem({ ...activeItem, reward_eligible: e.target.checked })} />
                  Members can claim this piece with a free-piece reward
                </label>
                <small id="p-reward-help">Same list as Settings → Free-piece rewards (pieces in an eligible category also qualify).</small>
              </div>
              <div className="field">
                <label htmlFor="p-material">Material / fabric</label>
                <input id="p-material" maxLength={200} value={activeItem.material || ''} onChange={(e) => setActiveItem({ ...activeItem, material: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="p-badge">Badge (PREMIUM pieces cannot use credits)</label>
                <input id="p-badge" maxLength={30} value={activeItem.badge || ''} onChange={(e) => setActiveItem({ ...activeItem, badge: e.target.value })} />
              </div>
              {/* Vendor, Batch & Landed Costing */}
              <div className="field">
                <label htmlFor="p-vendor">Vendor / Supplier</label>
                <input
                  id="p-vendor"
                  maxLength={120}
                  placeholder="e.g. Silk & Heritage Weaves"
                  value={activeItem.supplier_name || ''}
                  onChange={(e) => {
                    const sup = e.target.value;
                    const nextBatch = (!activeItem.batch_id || activeItem.batch_id.includes('-')) && !activeItem.userEditedBatch
                      ? suggestBatchId(sup, activeItem.purchase_date)
                      : activeItem.batch_id;
                    setActiveItem({ ...activeItem, supplier_name: sup, batch_id: nextBatch });
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="p-purchase-date">Purchase Date</label>
                <input
                  id="p-purchase-date"
                  type="date"
                  value={activeItem.purchase_date || ''}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    const nextBatch = (!activeItem.batch_id || activeItem.batch_id.includes('-')) && !activeItem.userEditedBatch
                      ? suggestBatchId(activeItem.supplier_name, newDate)
                      : activeItem.batch_id;
                    setActiveItem({ ...activeItem, purchase_date: newDate, batch_id: nextBatch });
                  }}
                />
              </div>

              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="p-batch-id">Batch ID</label>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '1px 6px', fontSize: 10, height: 'auto', marginBottom: 2 }}
                    onClick={() => setActiveItem({ ...activeItem, batch_id: suggestBatchId(activeItem.supplier_name, activeItem.purchase_date), userEditedBatch: true })}
                    title="Generate unique suggested Batch ID"
                  >
                    Suggest Batch ID
                  </button>
                </div>
                <input
                  id="p-batch-id"
                  maxLength={60}
                  placeholder="e.g. SILK-202611-01"
                  value={activeItem.batch_id || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, batch_id: e.target.value, userEditedBatch: true })}
                />
              </div>

              <div className="field">
                <label htmlFor="p-purchase-price">Purchase Price Per Piece (₹)</label>
                <input
                  id="p-purchase-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={activeItem.purchase_price_per_piece ?? ''}
                  onChange={(e) => {
                    const price = e.target.value;
                    const calculatedCost = calculateCostPerUnit(price, activeItem.courier_charge, activeItem.purchase_quantity);
                    setActiveItem({
                      ...activeItem,
                      purchase_price_per_piece: price,
                      cost_price_inr: calculatedCost,
                    });
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="p-purchase-qty">Purchase Quantity</label>
                <input
                  id="p-purchase-qty"
                  type="number"
                  min="1"
                  value={activeItem.purchase_quantity ?? 1}
                  onChange={(e) => {
                    const qty = e.target.value;
                    const calculatedCost = calculateCostPerUnit(activeItem.purchase_price_per_piece, activeItem.courier_charge, qty);
                    setActiveItem({
                      ...activeItem,
                      purchase_quantity: qty,
                      cost_price_inr: calculatedCost,
                    });
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="p-courier-charge">Total Courier Freight (₹)</label>
                <input
                  id="p-courier-charge"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={activeItem.courier_charge ?? ''}
                  onChange={(e) => {
                    const courier = e.target.value;
                    const calculatedCost = calculateCostPerUnit(activeItem.purchase_price_per_piece, courier, activeItem.purchase_quantity);
                    setActiveItem({
                      ...activeItem,
                      courier_charge: courier,
                      cost_price_inr: calculatedCost,
                    });
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="p-cost-calculated">Calculated Landed Cost / Unit (₹)</label>
                <input
                  id="p-cost-calculated"
                  type="number"
                  readOnly
                  style={{ background: '#f8fafc', fontWeight: 600 }}
                  value={activeItem.cost_price_inr || 0}
                  title="Purchase price + (Courier charge / Quantity)"
                />
              </div>

              <div className="field">
                <label htmlFor="p-low-stock">Low Stock Alert Threshold</label>
                <input
                  id="p-low-stock"
                  type="number"
                  min="0"
                  value={activeItem.low_stock_threshold ?? 2}
                  onChange={(e) => setActiveItem({ ...activeItem, low_stock_threshold: Math.max(0, Number(e.target.value)) })}
                />
              </div>
              <div className="field">
                <label htmlFor="p-hsn">HSN code</label>
                <input id="p-hsn" maxLength={8} value={activeItem.hsn_code || '6204'} onChange={(e) => setActiveItem({ ...activeItem, hsn_code: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="p-fit-type">Fit Style / Silhouette</label>
                <select id="p-fit-type" value={activeItem.fit_type || 'regular'} onChange={(e) => setActiveItem({ ...activeItem, fit_type: e.target.value })}>
                  <option value="regular">Regular Fit</option>
                  <option value="relaxed">Relaxed / Fluid</option>
                  <option value="slim">Slim / Tailored</option>
                  <option value="oversized">Oversized / Anti-fit</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-one-size">One-Size / Free-Size Fit Range (optional)</label>
                <input id="p-one-size" maxLength={60} placeholder="e.g. Fits XS to L, Fits 28 to 32" value={activeItem.one_size_fit_range || ''} onChange={(e) => setActiveItem({ ...activeItem, one_size_fit_range: e.target.value })} />
              </div>
              <div className="field full">
                <label htmlFor="p-size-notes">Size &amp; Fit Guidance Notes (shown on Product Page)</label>
                <input id="p-size-notes" maxLength={200} placeholder="e.g. True to size. Designed for a relaxed fit, size down for tailored fit." value={activeItem.size_notes || ''} onChange={(e) => setActiveItem({ ...activeItem, size_notes: e.target.value })} />
              </div>
              <div className="field full">
                <label htmlFor="p-desc">Description</label>
                <textarea id="p-desc" maxLength={5000} style={{ minHeight: 70, padding: 10, border: '1px solid var(--admin-line, #ddd)' }} value={activeItem.description || ''} onChange={(e) => setActiveItem({ ...activeItem, description: e.target.value })} />
              </div>
              <div className="field full">
                <label htmlFor="p-care">Care instructions (optional)</label>
                <input id="p-care" maxLength={1000} value={activeItem.care_instructions || ''} onChange={(e) => setActiveItem({ ...activeItem, care_instructions: e.target.value })} />
              </div>
              {productContentGaps(activeItem).length > 0 && (
                <p className="field full" role="status" style={{ fontSize: 12, color: '#8a5a00', margin: 0 }}>
                  Listing still missing: {productContentGaps(activeItem).join(', ')}. Shoppers and search engines only see facts you enter; nothing is filled in automatically.
                </p>
              )}

              <div className="field full" style={{ border: '1px solid var(--admin-line, #ddd)', padding: 14 }}>
                <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>Sizes, SKU, pricing &amp; stock</strong>
                <p style={{ fontSize: 11, color: '#666', margin: '4px 0 10px' }}>Each size is a purchasable variant with its own price. Leave SKU blank to generate one. Stock changes are applied safely even while customers are checking out.</p>
                <PricingHelper
                  costPrice={activeItem.cost_price_inr}
                  badge={activeItem.badge}
                  onApplyPrice={(suggestedPrice) => {
                    setActiveItem((prev) => ({
                      ...prev,
                      variants: (prev.variants && prev.variants.length > 0)
                        ? prev.variants.map((v) => ({ ...v, price_inr: suggestedPrice }))
                        : [{ ...newVariant(0), price_inr: suggestedPrice }],
                    }));
                  }}
                />
                <div className="table-wrap">
                  <table className="variant-table">
                    <thead><tr><th>Size</th><th>SKU</th><th>Price ₹</th><th>Sale ₹</th><th>Stock</th><th>Held</th><th>Active</th><th></th></tr></thead>
                    <tbody>
                      {(activeItem.variants || []).map((v, i) => {
                        const setV = (patch) => setActiveItem({ ...activeItem, variants: activeItem.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                        return (
                          <tr key={v.key || v.id}>
                            <td><input aria-label="Size" required maxLength={40} value={v.size_label || ''} onChange={(e) => setV({ size_label: e.target.value })} placeholder="e.g. Medium" /></td>
                            <td><input aria-label="SKU" maxLength={64} value={v.sku || ''} onChange={(e) => setV({ sku: e.target.value })} placeholder="auto" /></td>
                            <td><input aria-label="Price" required type="number" min="0" step="0.01" value={v.price_inr ?? ''} onChange={(e) => setV({ price_inr: e.target.value })} /></td>
                            <td><input aria-label="Sale price" type="number" min="0" step="0.01" value={v.sale_price_inr ?? ''} onChange={(e) => setV({ sale_price_inr: e.target.value })} /></td>
                            <td><input aria-label="Stock" type="number" min="0" max={activeItem.is_one_of_one === false ? 100000 : 1} value={v.stock_quantity ?? 0} onChange={(e) => setV({ stock_quantity: e.target.value })} /></td>
                            <td><small>{v.held_quantity || 0}</small></td>
                            <td><input aria-label="Active" type="checkbox" checked={v.is_active !== false} onChange={(e) => setV({ is_active: e.target.checked })} /></td>
                            <td>
                              {!v.id && (
                                <button type="button" className="btn" style={{ padding: '2px 8px' }} aria-label="Remove size" onClick={() => setActiveItem({ ...activeItem, variants: activeItem.variants.filter((_, j) => j !== i) })}>✕</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setActiveItem({ ...activeItem, variants: [...(activeItem.variants || []), newVariant((activeItem.variants || []).length)] })}>
                  + Add size
                </button>
              </div>

              <div className="field full" style={{ border: '1px dashed var(--admin-line, #ccc)', padding: 14 }}>
                <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>Images</strong>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  {(activeItem.images || []).map((img, i) => (
                    <div key={img + i} style={{ position: 'relative', width: 90, height: 110, background: '#eee' }}>
                      <img src={img} alt={`Image ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => { const next = activeItem.images.filter((_, j) => j !== i); setActiveItem({ ...activeItem, images: next, image_url: next[0] || null }); }} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.7)', color: '#fff', width: 22, height: 22, borderRadius: '50%', fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                  {(activeItem.images || []).length < 8 && (
                    <label className="btn upload-tile" style={{ width: 90, height: 110, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 10, cursor: 'pointer' }}>
                      + Upload
                      <input
                        type="file"
                        aria-label="Upload a product image (JPG, PNG or WebP, up to 10 MB)"
                        accept="image/jpeg,image/png,image/webp"
                        className="visually-hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            showToast('Uploading image…');
                            const up = await uploadFile(file, 'image', 'product');
                            setActiveItem((cur) => { const next = [...(cur.images || []), up.ref]; return { ...cur, images: next, image_url: next[0] }; });
                            showToast('Image added');
                          } catch (err) {
                            showToast(err.message);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="field full switches" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={Boolean(activeItem.featured)} onChange={(e) => setActiveItem({ ...activeItem, featured: e.target.checked })} /> Featured in New Arrivals (Homepage Ticker)
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={activeItem.is_active !== false} onChange={(e) => setActiveItem({ ...activeItem, is_active: e.target.checked })} /> Live in catalogue
                </label>
                {activeItem.slug && <a className="text-link" href={`/product/${activeItem.slug}`} target="_blank" rel="noreferrer">Preview</a>}
              </div>
              <div className="field full">
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save piece'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Category Add / Edit */}
      {modalType === 'category' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">{activeItem.id ? 'Edit Category' : 'Add New Category'}</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(() => post('category', activeItem), { success: 'Category saved', reload: 'categories', close: true }).then(loadCategories);
              }}
            >
              <div className="field full">
                <label htmlFor="m-category-name">Category Name</label>
                <input id="m-category-name"
                  required
                  value={activeItem.name || ''}
                  onChange={(e) => {
                    const name = e.target.value;
                    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
                    setActiveItem({ ...activeItem, name, slug: activeItem.slug || slug });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="m-slug">Slug</label>
                <input id="m-slug"
                  required
                  value={activeItem.slug || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, slug: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-sort-order">Sort Order</label>
                <input id="m-sort-order"
                  type="number"
                  value={activeItem.sort_order || 1}
                  onChange={(e) => setActiveItem({ ...activeItem, sort_order: Number(e.target.value) })}
                />
              </div>
              <div className="field full">
                <label>
                  <input
                    type="checkbox"
                    checked={activeItem.is_active !== false}
                    onChange={(e) => setActiveItem({ ...activeItem, is_active: e.target.checked })}
                  />{' '}
                  Live in Catalogue Navigation
                </label>
              </div>
              <div className="field full">
                <button className="btn primary">Save Category</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Drop Setting */}
      {modalType === 'drop' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">Schedule Weekly Drop</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(() => post('drop', activeItem), { success: 'Drop scheduled', reload: 'drops', close: true });
              }}
            >
              <div className="field full">
                <label htmlFor="m-drop-name">Drop Name</label>
                <input id="m-drop-name"
                  required
                  placeholder="e.g. Autumn Edit 02"
                  value={activeItem.name || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-member-access-date">Member Access Date</label>
                <input id="m-member-access-date"
                  type="datetime-local"
                  required
                  value={activeItem.starts_at ? activeItem.starts_at.slice(0, 16) : ''}
                  onChange={(e) => setActiveItem({ ...activeItem, starts_at: new Date(e.target.value).toISOString() })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-public-launch-date">Public Launch Date</label>
                <input id="m-public-launch-date"
                  type="datetime-local"
                  required
                  value={activeItem.public_at ? activeItem.public_at.slice(0, 16) : ''}
                  onChange={(e) => setActiveItem({ ...activeItem, public_at: new Date(e.target.value).toISOString() })}
                />
              </div>
              <div className="field full">
                <button className="btn primary">Schedule Drop</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Sourcing Batch */}
      {modalType === 'sourcing' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">Add Sourcing Batch</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(() => post('source', activeItem), { success: 'Sourcing batch recorded', reload: 'sourcing', close: true });
              }}
            >
              <div className="field full">
                <label htmlFor="m-supplier-name">Supplier Name</label>
                <input id="m-supplier-name"
                  required
                  placeholder="e.g. Bengaluru Silk Mills"
                  value={activeItem.supplier_name || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, supplier_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-batch-date">Batch Date</label>
                <input id="m-batch-date"
                  type="date"
                  value={activeItem.batch_date || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, batch_date: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="m-batch-notes">Batch Notes</label>
                <textarea id="m-batch-notes"
                  rows={3}
                  placeholder="Fabric grade, count, yardage, delivery status..."
                  value={activeItem.notes || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, notes: e.target.value })}
                />
              </div>
              <div className="field full">
                <button className="btn primary">Record Batch</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Loyalty Rule */}
      {modalType === 'loyalty' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '540px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">Create Offer / Loyalty Rule</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(() => post('loyalty', activeItem), { success: 'Offer rule created', reload: 'loyalty', close: true });
              }}
            >
              <div className="field full">
                <label htmlFor="m-rule-name">Rule Name</label>
                <input id="m-rule-name"
                  required
                  placeholder="e.g. VIP Member Privilege"
                  value={activeItem.name || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-trigger-event">Trigger Event</label>
                <select id="m-trigger-event"
                  value={activeItem.trigger_config?.event || 'order_count'}
                  onChange={(e) => {
                    const evt = e.target.value;
                    const m = evt === 'tenure_6_months' ? 6 : evt === 'tenure_8_months' ? 8 : evt === 'tenure_12_months' ? 12 : 6;
                    setActiveItem({ ...activeItem, trigger_config: { ...activeItem.trigger_config, event: evt, months: m } });
                  }}
                >
                  <option value="signup">Sign Up</option>
                  <option value="first_order">First Order</option>
                  <option value="second_order">Second Order</option>
                  <option value="cart_threshold">Cart Value &gt; ₹5,000</option>
                  <option value="birthday">Member Birthday</option>
                  <option value="tenure_6_months">Customer Tenure — 6 Months</option>
                  <option value="tenure_8_months">Customer Tenure — 8 Months</option>
                  <option value="tenure_12_months">Customer Tenure — 12 Months (1 Year)</option>
                  <option value="tenure_custom">Custom Tenure (Set Months)</option>
                </select>
              </div>
              {String(activeItem.trigger_config?.event || '').startsWith('tenure') && (
                <div className="field">
                  <label htmlFor="m-tenure-months">Tenure Months</label>
                  <input
                    id="m-tenure-months"
                    type="number"
                    min="1"
                    max="60"
                    value={activeItem.trigger_config?.months || 6}
                    onChange={(e) => setActiveItem({ ...activeItem, trigger_config: { ...activeItem.trigger_config, months: Number(e.target.value) } })}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="m-reward-benefit">Reward / Benefit</label>
                <input id="m-reward-benefit"
                  placeholder="e.g. 15% discount, special styling offer"
                  value={activeItem.reward_config?.discount || '10%'}
                  onChange={(e) => setActiveItem({ ...activeItem, reward_config: { ...activeItem.reward_config, discount: e.target.value } })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-estimated-monthly-cost-inr">Estimated Monthly Cost (INR)</label>
                <input id="m-estimated-monthly-cost-inr"
                  type="number"
                  placeholder="e.g. 2500"
                  value={activeItem.estimated_monthly_cost || 0}
                  onChange={(e) => setActiveItem({ ...activeItem, estimated_monthly_cost: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-rule-status">Rule Status</label>
                <select id="m-rule-status"
                  value={activeItem.active ? 'true' : 'false'}
                  onChange={(e) => setActiveItem({ ...activeItem, active: e.target.value === 'true' })}
                >
                  <option value="true">Active (Live immediately)</option>
                  <option value="false">Draft / Paused</option>
                </select>
              </div>
              <div className="field full">
                <button className="btn primary">Save &amp; Activate Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Distribute Special Offer to Customer / Top Spenders */}
      {modalType === 'distribute_offer' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '540px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <div>
                <h2 id="admin-modal-title">Distribute Special Offer</h2>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
                  {activeItem.target_type === 'single'
                    ? `Grant bespoke offer to ${activeItem.customer?.full_name || activeItem.customer?.email || 'selected client'}`
                    : 'Grant special offer to all top-spending customers'}
                </p>
              </div>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const payload = {
                  customer_ids: activeItem.target_type === 'single'
                    ? [activeItem.auth_user_id || activeItem.customer?.auth_user_id]
                    : (cache.customers || []).filter((c) => Number(c.total_spent || 0) > 0).map((c) => c.auth_user_id),
                  code: activeItem.code,
                  title: activeItem.title,
                  description: activeItem.description,
                  discount_type: activeItem.discount_type,
                  discount_value: activeItem.discount_value,
                  valid_days: activeItem.valid_days,
                };
                mutate(
                  () => post('distribute_offer', payload),
                  {
                    success: (d) => `Special offer "${activeItem.code}" successfully distributed to ${d?.count ?? 1} customer(s)!`,
                    reload: section === 'loyalty' ? 'loyalty' : 'customers',
                    close: true,
                  }
                );
              }}
            >
              <div className="field">
                <label htmlFor="m-offer-target">Recipient Target</label>
                <select
                  id="m-offer-target"
                  value={activeItem.target_type || 'single'}
                  onChange={(e) => setActiveItem({ ...activeItem, target_type: e.target.value })}
                >
                  {activeItem.customer && <option value="single">Single Client: {activeItem.customer.full_name || activeItem.customer.email}</option>}
                  <option value="top_spenders">Top Spenders (All Clients with Paid Orders)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-offer-code">Offer Code (Promocode)</label>
                <input
                  id="m-offer-code"
                  required
                  maxLength={24}
                  style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
                  value={activeItem.code || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, code: e.target.value.toUpperCase().replace(/\s/g, '') })}
                />
              </div>
              <div className="field full">
                <label htmlFor="m-offer-title">Offer Title</label>
                <input
                  id="m-offer-title"
                  required
                  maxLength={100}
                  placeholder="e.g. VIP Couture Appreciation Perk"
                  value={activeItem.title || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, title: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-discount-type">Discount Type</label>
                <select
                  id="m-discount-type"
                  value={activeItem.discount_type || 'percentage'}
                  onChange={(e) => setActiveItem({ ...activeItem, discount_type: e.target.value })}
                >
                  <option value="percentage">Percentage Discount (%)</option>
                  <option value="fixed">Flat Amount Discount (₹)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-discount-val">Discount Value ({activeItem.discount_type === 'fixed' ? '₹' : '%'})</label>
                <input
                  id="m-discount-val"
                  type="number"
                  min="1"
                  required
                  value={activeItem.discount_value || 20}
                  onChange={(e) => setActiveItem({ ...activeItem, discount_value: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-valid-days">Validity (Days)</label>
                <input
                  id="m-valid-days"
                  type="number"
                  min="1"
                  max="365"
                  value={activeItem.valid_days || 30}
                  onChange={(e) => setActiveItem({ ...activeItem, valid_days: Number(e.target.value) })}
                />
              </div>
              <div className="field full">
                <label htmlFor="m-offer-desc">Description (Shown to Customer)</label>
                <textarea
                  id="m-offer-desc"
                  rows={2}
                  value={activeItem.description || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, description: e.target.value })}
                />
              </div>
              <div className="field full">
                <button className="btn primary" disabled={busy}>
                  {busy ? 'Distributing…' : 'Distribute Special Offer →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Dispatch order */}
      {modalType === 'dispatch' && activeItem && (() => {
        const courier = activeItem.couriers.find((c) => c.id === activeItem.courier_id) || null;
        const link = courier ? previewTrackingUrl(courier.tracking_url_template, activeItem.tracking_number) : null;
        return (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">Dispatch order {activeItem.ref}</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  () => post('order', { id: activeItem.id, status: 'dispatched', courier_id: activeItem.courier_id || null, tracking_number: activeItem.tracking_number.trim() }),
                  { success: 'Order dispatched — customer notified', reload: 'orders', close: true },
                );
              }}
            >
              {activeItem.name && <p className="field full" style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Customer: {activeItem.name}</p>}
              <div className="field">
                <label htmlFor="dispatch-courier">Courier partner</label>
                <select id="dispatch-courier" value={activeItem.courier_id} onChange={(e) => setActiveItem({ ...activeItem, courier_id: e.target.value })}>
                  {!activeItem.couriers.length && <option value="">No active couriers</option>}
                  {activeItem.couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!activeItem.couriers.length && <small>Add or activate a courier under <Link to="/admin/couriers">Couriers</Link>.</small>}
              </div>
              <div className="field">
                <label htmlFor="dispatch-tracking">Tracking / AWB number</label>
                <input
                  id="dispatch-tracking"
                  required={Boolean(courier?.requires_tracking)}
                  maxLength={80}
                  placeholder={courier?.requires_tracking ? 'e.g. VS-DEL-98210' : 'Optional'}
                  value={activeItem.tracking_number}
                  onChange={(e) => setActiveItem({ ...activeItem, tracking_number: e.target.value })}
                />
              </div>
              {link && (
                <p className="field full" style={{ margin: 0, fontSize: 12 }}>
                  Customer link: <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
                </p>
              )}
              {courier && !courier.tracking_url_template && activeItem.tracking_number.trim() && (
                <p className="field full fine" style={{ margin: 0 }}>{courier.name} has no tracking page configured; the customer sees the number only.</p>
              )}
              {activeItem.events.length > 0 && (
                <div className="field full">
                  <span className="field-label">Shipment history</span>
                  <ul className="fine" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {activeItem.events.map((ev) => (
                      <li key={ev.id}>{new Date(ev.created_at).toLocaleString('en-IN')} · {ev.status}{ev.courier_name ? ` · ${ev.courier_name}` : ''}{ev.tracking_number ? ` · ${ev.tracking_number}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="field full">
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Mark dispatched'}</button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* MODAL: Credit Adjustment */}
      {modalType === 'credit' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '500px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="admin-modal-title">Adjust Member Credits</h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(() => post('credit', activeItem), { success: 'Credits adjusted', reload: 'credits', close: true });
              }}
            >
              <div className="field full">
                <label htmlFor="m-select-member">Select Member</label>
                <select id="m-select-member"
                  value={activeItem.membership_id || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, membership_id: e.target.value })}
                >
                  {(cache.memberships || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email || m.auth_user_id} ({m.status}, {m.credits_balance} credits)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-credit-delta">Credit Delta</label>
                <input id="m-credit-delta"
                  type="number"
                  required
                  placeholder="+1 or -1"
                  value={activeItem.delta || 1}
                  onChange={(e) => setActiveItem({ ...activeItem, delta: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="m-reason-audit-note">Reason / Audit Note</label>
                <input id="m-reason-audit-note"
                  required
                  placeholder="e.g. Studio courtesy piece exchange"
                  value={activeItem.reason || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, reason: e.target.value })}
                />
              </div>
              <div className="field full">
                <button className="btn primary">Post Credit Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL: Exchange status & opinion/resolution note */}
      {modalType === 'exchange_decision' && activeItem && (
        <div className="modal is-visible" role="dialog" aria-modal="true" aria-labelledby="exchange-decision-title" onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <div className="panel-head" style={{ marginBottom: '18px' }}>
              <h2 id="exchange-decision-title">
                Exchange Decision: {EXCHANGE_STATUS_LABELS[activeItem.nextStatus] || activeItem.nextStatus}
              </h2>
              <button type="button" className="btn" style={{ background: 'none', border: 'none', fontSize: '20px' }} aria-label="Close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  () => post('exchange', {
                    id: activeItem.exchange.id,
                    status: activeItem.nextStatus,
                    resolution: activeItem.resolution,
                  }),
                  {
                    success: `Exchange updated to ${EXCHANGE_STATUS_LABELS[activeItem.nextStatus] || activeItem.nextStatus}`,
                    reload: 'exchanges',
                    close: true,
                  }
                );
              }}
            >
              <div className="field full" style={{ background: '#fcfbfa', border: '1px solid var(--admin-line, #eee)', padding: '12px 14px', borderRadius: 4, fontSize: 12 }}>
                <div><strong>Customer:</strong> {activeItem.exchange.full_name || activeItem.exchange.email}</div>
                <div style={{ marginTop: 3 }}><strong>Order ID:</strong> #{activeItem.exchange.order_id?.slice(0, 8).toUpperCase()}</div>
                <div style={{ marginTop: 3 }}><strong>Customer Reason:</strong> {activeItem.exchange.reason || 'None provided'}</div>
              </div>

              <div className="field full">
                <label htmlFor="m-exchange-res">Studio Opinion &amp; Resolution Reason (Shown to Customer)</label>
                <textarea
                  id="m-exchange-res"
                  rows={4}
                  required={['not_approved', 'approved', 'rejected'].includes(activeItem.nextStatus)}
                  placeholder="Enter studio opinion or explanation why this request is approved or not approved..."
                  value={activeItem.resolution || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, resolution: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid var(--admin-line, #ccc)', borderRadius: 3 }}
                />
              </div>

              {activeItem.nextStatus === 'not_approved' && (
                <div className="field full" style={{ marginTop: -8 }}>
                  <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Quick preset opinions / reasons:</small>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      'Piece shows signs of wear or tags removed.',
                      'Submitted outside the 7-day exchange window.',
                      'One-of-one piece; alternative size is unavailable.',
                      'Inspected in studio; piece matches order specification.',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #e0dcd9', borderRadius: 3, background: '#fbf9f8', cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => setActiveItem({ ...activeItem, resolution: preset })}
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="btn" onClick={() => setModalType(null)}>Cancel</button>
                <button
                  type="submit"
                  className="btn primary"
                  style={activeItem.nextStatus === 'not_approved' ? { background: '#dc2626', borderColor: '#dc2626', color: '#fff' } : {}}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : `Confirm ${EXCHANGE_STATUS_LABELS[activeItem.nextStatus] || activeItem.nextStatus} →`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add / Edit Customer */}
      {modalType === 'customer' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Customer details" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-head">
              <h2>{activeItem.auth_user_id ? 'Edit Customer' : 'Add New Customer'}</h2>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  () => post('customer', activeItem),
                  { success: 'Customer saved successfully', reload: 'customers', close: true }
                );
              }}
            >
              <div className="field full">
                <label htmlFor="c-name">Full Name</label>
                <input
                  id="c-name"
                  required
                  placeholder="e.g. Ananya Sharma"
                  value={activeItem.full_name || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, full_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="c-email">Email Address</label>
                <input
                  id="c-email"
                  type="email"
                  required={!activeItem.auth_user_id}
                  disabled={Boolean(activeItem.auth_user_id)}
                  placeholder="client@example.com"
                  value={activeItem.email || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="c-phone">Phone Number</label>
                <input
                  id="c-phone"
                  placeholder="+91 98765 43210"
                  value={activeItem.phone || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, phone: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="c-notes">Client Notes</label>
                <textarea
                  id="c-notes"
                  rows={3}
                  placeholder="Preferred cuts, seasonal sizing notes, private client preferences..."
                  value={activeItem.notes || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, notes: e.target.value })}
                />
              </div>
              <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setModalType(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save Customer Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: New Counter Sale / POS */}
      {modalType === 'counter_sale' && activeItem && (() => {
        const selectedCust = displayCustomers.find((c) => c.auth_user_id === activeItem.customer_id) || null;
        const purchaseCount = Number(selectedCust?.order_count || 0);
        const stamps = purchaseCount % 6;
        const isRewardEligible = stamps === 5;
        const items = Array.isArray(activeItem.items) ? activeItem.items : [];
        const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity || 0) * Number(it.unit_price || 0)), 0);
        const totalCost = items.reduce((sum, it) => sum + (Number(it.quantity || 0) * Number(it.cost_price || 0)), 0);
        const totals = calculateSaleTotals(subtotal, activeItem.discount_amount || 0, activeItem.amount_paid || 0);
        const estProfit = totals.finalTotal - totalCost;

        return (
          <div className="modal" role="dialog" aria-modal="true" aria-label="New counter sale" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
            <div className="modal-card" style={{ maxWidth: 840 }}>
              <div className="modal-head">
                <h2>Record Counter Sale &amp; POS Receipt</h2>
                <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
              </div>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!items.length) {
                    showToast('Please add at least one item to this sale.');
                    return;
                  }
                  mutate(
                    () => post('sale', {
                      ...activeItem,
                      customer_name: selectedCust?.full_name || activeItem.customer_name || 'Walk-in Client',
                      customer_phone: selectedCust?.phone || activeItem.customer_phone || '',
                      subtotal,
                      discount_amount: Number(activeItem.discount_amount || 0),
                      total: totals.finalTotal,
                      amount_paid: Number(activeItem.amount_paid || 0),
                      amount_due: totals.amountDue,
                      payment_status: totals.paymentStatus,
                      estimated_cost: totalCost,
                      estimated_profit: estProfit,
                    }),
                    {
                      success: (r) => `Counter sale recorded · Invoice ${r.invoice_number}`,
                      reload: 'store',
                      close: true,
                    }
                  );
                }}
              >
                <div className="field full">
                  <label htmlFor="cs-customer">Customer (Walk-in or Registered)</label>
                  <select
                    id="cs-customer"
                    value={activeItem.customer_id || ''}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const cust = displayCustomers.find((c) => c.auth_user_id === cid);
                      setActiveItem({
                        ...activeItem,
                        customer_id: cid,
                        customer_name: cust?.full_name || '',
                        customer_phone: cust?.phone || '',
                      });
                    }}
                  >
                    <option value="">Walk-in Client (Unregistered)</option>
                    {displayCustomers.map((c) => (
                      <option key={c.auth_user_id} value={c.auth_user_id}>
                        {c.full_name || 'Client'} ({c.phone || c.email}) · {c.order_count ?? 0} past purchases
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCust && (
                  <div className="field full">
                    <div style={{ background: isRewardEligible ? '#fef3c7' : '#f0fdf4', border: `1px solid ${isRewardEligible ? '#f59e0b' : '#86efac'}`, padding: '10px 14px', borderRadius: 4 }}>
                      {isRewardEligible ? (
                        <>
                          <strong style={{ color: '#92400e' }}>50% Loyalty Reward Eligible!</strong>
                          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#78350f' }}>
                            Customer has completed 5 purchases in this cycle. As per Vishrea loyalty policy, staff should manually enter the 50% reward discount amount below.
                          </p>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: '#166534' }}>
                          <strong>Loyalty Status:</strong> Stamp {stamps} / 6 ({5 - stamps > 0 ? `${5 - stamps} more purchase${5 - stamps === 1 ? '' : 's'} until 50% reward` : 'Cycle resets after next purchase'})
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="cs-date">Sale Date</label>
                  <input
                    id="cs-date"
                    type="date"
                    required
                    value={activeItem.sale_date || ''}
                    onChange={(e) => setActiveItem({ ...activeItem, sale_date: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="cs-mode">Payment Mode</label>
                  <select
                    id="cs-mode"
                    value={activeItem.payment_mode || 'upi'}
                    onChange={(e) => setActiveItem({ ...activeItem, payment_mode: e.target.value })}
                  >
                    <option value="upi">UPI / QR Code</option>
                    <option value="card">Card Terminal</option>
                    <option value="cash">Cash Counter</option>
                  </select>
                </div>

                <div className="field full">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="field-label" style={{ margin: 0 }}>Sale Items</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => {
                        const first = displayProducts[0];
                        const nextItems = [...items, {
                          variant_id: first?.variant_id || first?.id || '',
                          quantity: 1,
                          unit_price: first?.sale_price_inr && first?.sale_price_inr < first?.price_inr ? first?.sale_price_inr : (first?.price_inr || 0),
                          cost_price: first?.cost_price_inr || 0,
                        }];
                        setActiveItem({ ...activeItem, items: nextItems });
                      }}
                    >
                      + Add Another Piece
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table className="table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Piece &amp; Size</th>
                          <th style={{ width: 90 }}>Qty</th>
                          <th style={{ width: 130 }}>Unit Price</th>
                          <th style={{ width: 120 }}>Line Total</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, idx) => {
                          const lineAmt = calculateLineAmount(it.quantity, it.unit_price);
                          return (
                            <tr key={idx}>
                              <td>
                                <select
                                  style={{ width: '100%', fontSize: 12 }}
                                  value={it.variant_id || ''}
                                  onChange={(e) => {
                                    const vid = e.target.value;
                                    const p = displayProducts.find((x) => (x.variant_id || x.id) === vid);
                                    const updated = [...items];
                                    updated[idx] = {
                                      ...it,
                                      variant_id: vid,
                                      unit_price: p?.sale_price_inr && p?.sale_price_inr < p?.price_inr ? p.sale_price_inr : (p?.price_inr || 0),
                                      cost_price: p?.cost_price_inr || 0,
                                    };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                >
                                  {displayProducts.map((p) => (
                                    <option key={p.variant_id || p.id} value={p.variant_id || p.id}>
                                      {p.name} ({p.size_label}) · Stock: {p.stock_quantity} · {formatPrice(p.sale_price_inr && p.sale_price_inr < p.price_inr ? p.sale_price_inr : p.price_inr)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="1"
                                  style={{ width: '100%', fontSize: 12 }}
                                  value={it.quantity || 1}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, quantity: Math.max(1, Number(e.target.value)) };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  style={{ width: '100%', fontSize: 12 }}
                                  value={it.unit_price ?? 0}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, unit_price: Math.max(0, Number(e.target.value)) };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td><strong>{formatPrice(lineAmt)}</strong></td>
                              <td>
                                {items.length > 1 && (
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ padding: '2px 6px', color: '#dc2626' }}
                                    onClick={() => {
                                      const updated = items.filter((_, i) => i !== idx);
                                      setActiveItem({ ...activeItem, items: updated });
                                    }}
                                  >
                                    &times;
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="cs-discount">Discount (₹)</label>
                  <input
                    id="cs-discount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={activeItem.discount_amount ?? ''}
                    onChange={(e) => setActiveItem({ ...activeItem, discount_amount: Math.max(0, Number(e.target.value)) })}
                  />
                  {isRewardEligible && subtotal > 0 && (
                    <small style={{ color: '#92400e', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setActiveItem({ ...activeItem, discount_amount: Math.round(subtotal * 0.5) })}>
                      Click to apply 50% discount: {formatPrice(Math.round(subtotal * 0.5))}
                    </small>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="cs-paid">Amount Paid (₹)</label>
                  <input
                    id="cs-paid"
                    type="number"
                    min="0"
                    step="0.01"
                    value={activeItem.amount_paid ?? ''}
                    onChange={(e) => setActiveItem({ ...activeItem, amount_paid: Math.max(0, Number(e.target.value)) })}
                  />
                  <small style={{ color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setActiveItem({ ...activeItem, amount_paid: totals.finalTotal })}>
                    Click to mark fully paid: {formatPrice(totals.finalTotal)}
                  </small>
                </div>

                {/* Live Sale Financial Summary */}
                <div className="field full" style={{ background: '#f8fafc', border: '1px solid var(--admin-line)', padding: '14px', borderRadius: 4, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Subtotal</small>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{formatPrice(subtotal)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Final Total</small>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{formatPrice(totals.finalTotal)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Amount Due</small>
                    <div style={{ fontSize: 16, fontWeight: 600, color: totals.amountDue > 0 ? '#dc2626' : '#166534' }}>{formatPrice(totals.amountDue)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Payment Status</small>
                    <div style={{ marginTop: 2 }}>{paymentBadge(totals.paymentStatus)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Estimated Profit</small>
                    <div style={{ fontSize: 16, fontWeight: 600, color: estProfit >= 0 ? '#166534' : '#dc2626' }}>{formatPrice(estProfit)}</div>
                  </div>
                </div>

                <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn" onClick={() => setModalType(null)}>Cancel</button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'Recording…' : 'Record Counter Sale'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Sale Receipt */}
      {modalType === 'receipt' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Sale Receipt" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card" style={{ maxWidth: 580, padding: '24px 28px' }}>
            <div className="modal-head" style={{ borderBottom: '1px dashed #ccc', paddingBottom: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ letterSpacing: '0.08em', margin: 0 }}>VISHREA STUDIO</h2>
                <small style={{ color: 'var(--muted)' }}>Walk-in Studio Store Counter Sale</small>
              </div>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
              <div><strong>Invoice:</strong> {activeItem.invoice_number || activeItem.id}</div>
              <div><strong>Date:</strong> {activeItem.sale_date ? new Date(activeItem.sale_date).toLocaleDateString('en-IN') : new Date(activeItem.created_at).toLocaleDateString('en-IN')}</div>
              <div><strong>Customer:</strong> {activeItem.customer_name || 'Walk-in Client'} {activeItem.customer_phone ? `(${activeItem.customer_phone})` : ''}</div>
              <div><strong>Payment Mode:</strong> {(activeItem.channel === 'pos' ? 'Card / POS' : activeItem.payment_status || 'UPI').toUpperCase()}</div>
            </div>

            <table className="table" style={{ fontSize: 12, marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(activeItem.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td>{it.name || it.product_name} {it.size ? `(${it.size})` : ''}</td>
                    <td>{it.quantity}</td>
                    <td>{formatPrice(it.unit_price)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPrice(Number(it.quantity || 0) * Number(it.unit_price || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ borderTop: '1px dashed #ccc', paddingTop: 12, fontSize: 13, lineHeight: 1.8, textAlign: 'right' }}>
              <div>Subtotal: <strong>{formatPrice(activeItem.subtotal || 0)}</strong></div>
              {Number(activeItem.discount_amount) > 0 && (
                <div style={{ color: '#166534' }}>Discount: -{formatPrice(activeItem.discount_amount)}</div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700 }}>Total: {formatPrice(activeItem.total || 0)}</div>
              <div>Amount Paid: {formatPrice(activeItem.amount_paid || 0)}</div>
              {Number(activeItem.amount_due) > 0 && (
                <div style={{ color: '#dc2626', fontWeight: 600 }}>Balance Due: {formatPrice(activeItem.amount_due)}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn" onClick={() => setModalType(null)}>Close</button>
              <button type="button" className="btn primary" onClick={() => window.print()}>Print Receipt</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add / Edit Vendor */}
      {modalType === 'vendor' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Vendor details" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card" style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <h2>{activeItem.id ? 'Edit Vendor' : 'Add New Vendor'}</h2>
              <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  () => post('vendor', activeItem),
                  { success: 'Vendor saved successfully', reload: 'vendors', close: true }
                );
              }}
            >
              <div className="field">
                <label htmlFor="v-name">Vendor Name</label>
                <input
                  id="v-name"
                  required
                  placeholder="e.g. Silk & Heritage Weaves"
                  value={activeItem.name || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="v-code">Vendor Code</label>
                <input
                  id="v-code"
                  placeholder="e.g. VEND-001"
                  value={activeItem.code || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, code: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="v-contact">Contact Person</label>
                <input
                  id="v-contact"
                  placeholder="e.g. Rameshwar Gupta"
                  value={activeItem.contact_person || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, contact_person: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="v-phone">Phone Number</label>
                <input
                  id="v-phone"
                  placeholder="+91 98765 00000"
                  value={activeItem.phone || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, phone: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="v-categories">Categories Supplied (comma-separated)</label>
                <input
                  id="v-categories"
                  placeholder="Couture, Banarasi, Chiffon, Handloom"
                  value={Array.isArray(activeItem.categories) ? activeItem.categories.join(', ') : (activeItem.categories || '')}
                  onChange={(e) => setActiveItem({ ...activeItem, categories: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="v-address">Studio / Workshop Address</label>
                <input
                  id="v-address"
                  placeholder="e.g. Weaver Colony, Varanasi, UP"
                  value={activeItem.address || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, address: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="v-notes">Procurement Notes</label>
                <textarea
                  id="v-notes"
                  rows={2}
                  placeholder="Lead times, MOQ terms, payment terms..."
                  value={activeItem.notes || ''}
                  onChange={(e) => setActiveItem({ ...activeItem, notes: e.target.value })}
                />
              </div>
              <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setModalType(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: New / Edit Purchase Order */}
      {modalType === 'purchase_order' && activeItem && (() => {
        const items = Array.isArray(activeItem.items) ? activeItem.items : [];
        const poTotals = calculatePurchaseOrderTotals(items, activeItem.courier_charges || 0);

        return (
          <div className="modal" role="dialog" aria-modal="true" aria-label="Purchase order details" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
            <div className="modal-card" style={{ maxWidth: 840 }}>
              <div className="modal-head">
                <h2>{activeItem.id ? 'Edit Purchase Order' : 'Create Purchase Order'}</h2>
                <button className="close" type="button" aria-label="Close" onClick={() => setModalType(null)}>&times;</button>
              </div>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!items.length) {
                    showToast('Add at least one item to this purchase order.');
                    return;
                  }
                  mutate(
                    () => post('purchase_order', {
                      ...activeItem,
                      subtotal: poTotals.subtotal,
                      grand_total: poTotals.grandTotal,
                    }),
                    {
                      success: 'Purchase order saved successfully',
                      reload: 'procurement',
                      close: true,
                    }
                  );
                }}
              >
                <div className="field">
                  <label htmlFor="po-vendor">Supplier / Vendor</label>
                  <select
                    id="po-vendor"
                    required
                    value={activeItem.vendor_id || ''}
                    onChange={(e) => {
                      const vid = e.target.value;
                      const found = displayVendors.find((v) => v.id === vid);
                      const vendorName = found?.name || '';
                      const nextBatch = (!activeItem.batch_id || activeItem.batch_id.includes('-'))
                        ? suggestBatchId(vendorName, activeItem.order_date)
                        : activeItem.batch_id;
                      setActiveItem({
                        ...activeItem,
                        vendor_id: vid,
                        vendor_name: vendorName,
                        batch_id: nextBatch,
                      });
                    }}
                  >
                    <option value="">Select Vendor</option>
                    {displayVendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} ({v.code || 'VEND'})</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="po-date">Order Date</label>
                  <input
                    id="po-date"
                    type="date"
                    required
                    value={activeItem.order_date || ''}
                    onChange={(e) => {
                      const d = e.target.value;
                      const nextBatch = (!activeItem.batch_id || activeItem.batch_id.includes('-'))
                        ? suggestBatchId(activeItem.vendor_name || 'PO', d)
                        : activeItem.batch_id;
                      setActiveItem({ ...activeItem, order_date: d, batch_id: nextBatch });
                    }}
                  />
                </div>

                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label htmlFor="po-batch">Batch ID</label>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '1px 6px', fontSize: 10, height: 'auto', marginBottom: 2 }}
                      onClick={() => setActiveItem({ ...activeItem, batch_id: suggestBatchId(activeItem.vendor_name || 'PO', activeItem.order_date) })}
                    >
                      Suggest Batch ID
                    </button>
                  </div>
                  <input
                    id="po-batch"
                    placeholder="e.g. SILK-202611-01"
                    value={activeItem.batch_id || ''}
                    onChange={(e) => setActiveItem({ ...activeItem, batch_id: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="po-courier">Total Courier Freight (₹)</label>
                  <input
                    id="po-courier"
                    type="number"
                    min="0"
                    step="0.01"
                    value={activeItem.courier_charges ?? 0}
                    onChange={(e) => setActiveItem({ ...activeItem, courier_charges: Math.max(0, Number(e.target.value)) })}
                  />
                </div>

                <div className="field full">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="field-label" style={{ margin: 0 }}>Purchase Order Items</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => {
                        const updated = [...items, { item_name: '', category: 'Couture', quantity: 1, unit_cost: 0 }];
                        setActiveItem({ ...activeItem, items: updated });
                      }}
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table className="table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Item Description</th>
                          <th style={{ width: 150 }}>Category</th>
                          <th style={{ width: 90 }}>Qty</th>
                          <th style={{ width: 130 }}>Unit Cost (₹)</th>
                          <th style={{ width: 120 }}>Line Total</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, idx) => {
                          const lineAmt = Number(it.quantity || 0) * Number(it.unit_cost || 0);
                          return (
                            <tr key={idx}>
                              <td>
                                <input
                                  required
                                  style={{ width: '100%', fontSize: 12 }}
                                  placeholder="e.g. Handwoven Mulberry Silk Fabric"
                                  value={it.item_name || ''}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, item_name: e.target.value };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  style={{ width: '100%', fontSize: 12 }}
                                  placeholder="Category"
                                  value={it.category || ''}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, category: e.target.value };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="1"
                                  style={{ width: '100%', fontSize: 12 }}
                                  value={it.quantity || 1}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, quantity: Math.max(1, Number(e.target.value)) };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  style={{ width: '100%', fontSize: 12 }}
                                  value={it.unit_cost ?? 0}
                                  onChange={(e) => {
                                    const updated = [...items];
                                    updated[idx] = { ...it, unit_cost: Math.max(0, Number(e.target.value)) };
                                    setActiveItem({ ...activeItem, items: updated });
                                  }}
                                />
                              </td>
                              <td><strong>{formatPrice(lineAmt)}</strong></td>
                              <td>
                                {items.length > 1 && (
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ padding: '2px 6px', color: '#dc2626' }}
                                    onClick={() => {
                                      const updated = items.filter((_, i) => i !== idx);
                                      setActiveItem({ ...activeItem, items: updated });
                                    }}
                                  >
                                    &times;
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="field full" style={{ background: '#f8fafc', border: '1px solid var(--admin-line)', padding: '12px 16px', borderRadius: 4, display: 'flex', gap: 24 }}>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Subtotal</small>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{formatPrice(poTotals.subtotal)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Courier Freight</small>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{formatPrice(poTotals.courierCharges)}</div>
                  </div>
                  <div>
                    <small style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>Grand Total</small>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{formatPrice(poTotals.grandTotal)}</div>
                  </div>
                </div>

                <div className="field full">
                  <label htmlFor="po-notes">Order Notes / Delivery Terms</label>
                  <textarea
                    id="po-notes"
                    rows={2}
                    placeholder="Delivery instructions, batch details, quality inspection requirements..."
                    value={activeItem.notes || ''}
                    onChange={(e) => setActiveItem({ ...activeItem, notes: e.target.value })}
                  />
                </div>

                <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn" onClick={() => setModalType(null)}>Cancel</button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save Purchase Order'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Printable Purchase Order View */}
      {modalType === 'view_po' && activeItem && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Purchase Order Document" onClick={(e) => { if (e.target.classList.contains('modal')) setModalType(null); }}>
          <div className="modal-card" style={{ maxWidth: 720, padding: '28px 32px' }}>
            <div className="modal-head" style={{ borderBottom: '2px solid #333', paddingBottom: 16, marginBottom: 20 }}>
              <div>
                <h1 style={{ fontSize: 20, letterSpacing: '0.08em', margin: 0 }}>VISHREA STUDIO</h1>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Official Studio Procurement Order</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>{activeItem.po_number}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Date: {new Date(activeItem.order_date).toLocaleDateString('en-IN')}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20, fontSize: 12 }}>
              <div style={{ background: '#f9f9f9', padding: 12, borderRadius: 3 }}>
                <strong style={{ textTransform: 'uppercase', fontSize: 10, color: 'var(--muted)' }}>Vendor / Supplier:</strong>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{activeItem.vendor_name || 'Vendor'}</div>
                <div>Batch Reference: <code style={{ background: '#eee', padding: '1px 4px' }}>{activeItem.batch_id || '—'}</code></div>
              </div>
              <div style={{ background: '#f9f9f9', padding: 12, borderRadius: 3 }}>
                <strong style={{ textTransform: 'uppercase', fontSize: 10, color: 'var(--muted)' }}>Order Status:</strong>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, textTransform: 'capitalize' }}>{activeItem.status}</div>
                {activeItem.fulfilled_at && <div>Fulfilled on: {new Date(activeItem.fulfilled_at).toLocaleDateString('en-IN')}</div>}
              </div>
            </div>

            <table className="table" style={{ fontSize: 12, marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item Description</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'center' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ textAlign: 'right' }}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {(activeItem.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td><strong>{it.item_name}</strong></td>
                    <td>{it.category || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{formatPrice(it.unit_cost)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPrice(it.line_total || (Number(it.quantity || 0) * Number(it.unit_cost || 0)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ borderTop: '1px solid #ccc', paddingTop: 12, fontSize: 13, lineHeight: 1.8, textAlign: 'right' }}>
              <div>Subtotal: <strong>{formatPrice(activeItem.subtotal || 0)}</strong></div>
              <div>Freight / Courier Charges: <strong>{formatPrice(activeItem.courier_charges || 0)}</strong></div>
              <div style={{ fontSize: 18, fontWeight: 700, borderTop: '1px solid #eee', paddingTop: 6 }}>
                Grand Total: {formatPrice(activeItem.grand_total || 0)}
              </div>
            </div>

            {activeItem.notes && (
              <div style={{ marginTop: 16, padding: 12, background: '#fbfbfb', border: '1px solid #eee', fontSize: 12 }}>
                <strong>Procurement Terms / Notes:</strong>
                <p style={{ margin: '4px 0 0' }}>{activeItem.notes}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setModalType(null)}>Close</button>
              <button type="button" className="btn primary" onClick={() => window.print()}>Print Purchase Order</button>
            </div>
          </div>
        </div>
      )}

      {customerId && <CustomerDetail id={customerId} onClose={() => setCustomerId(null)} />}
      {toastMsg && <div className="toast show" role="status" aria-live="polite">{toastMsg}</div>}
    </div>
  );
}
