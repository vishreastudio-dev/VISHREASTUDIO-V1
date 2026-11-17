import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { ShoppingProfileSwitcher } from './ShoppingProfileSwitcher';
import { WhatsAppFloatingButton } from './WhatsAppFloatingButton';
import { SITE } from '../site.config.js';

// The search panel loads on first use; hovering or focusing the button fetches it early. If it
// cannot load (offline, or a tab left open across a deploy), the full catalogue page opens instead.
const loadSearch = () => import('./SearchOverlay');
const prefetchSearch = () => {
  loadSearch().catch(() => {});
};
const OpenCatalogue = () => {
  useEffect(() => window.location.assign('/catalogue'), []);
  return null;
};
const SearchOverlay = lazy(() =>
  loadSearch().then(
    (m) => ({ default: m.SearchOverlay }),
    () => ({ default: OpenCatalogue })
  )
);

const SearchIcon = () => (
  <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

const NAV = [
  ['/catalogue', 'Shop'],
  ['/catalogue/dresses', 'Dresses'],
  ['/membership', 'Membership'],
  ['/skin-tone', 'Find your colours'],
  ['/gifting', 'Gifting'],
];

const FOOTER_CATEGORIES = [
  ['tops', 'Tops'],
  ['dresses', 'Dresses'],
  ['coord-sets', 'Co-ord sets'],
  ['pants', 'Trousers'],
  ['party-dresses', 'Party dresses'],
  ['cardigans', 'Cardigans'],
];

export const Header = () => {
  const { cartCount, user } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <>
      <a href="#main-content" className="skip-to-content">Skip to main content</a>
      <div className="announcement">Free studio pickup in Bengaluru · ₹99 delivery across India</div>
      <header className="site-header">
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <Link className="wordmark" to="/">
          VISHREA <span>STUDIO</span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="search-trigger"
            aria-label="Search"
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            onPointerEnter={prefetchSearch}
            onFocus={prefetchSearch}
            onClick={() => {
              setMenuOpen(false);
              setSearchOpen(true);
            }}
          >
            <SearchIcon />
            <span className="search-trigger-label" aria-hidden="true">Search</span>
          </button>
          <ShoppingProfileSwitcher />
          <Link className="account-link" to={user ? '/account' : '/login'}>{user ? 'Account' : 'Sign in'}</Link>
          <Link className="bag-button" to="/cart" aria-label={`Shopping bag, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>
            Bag <span id="bagCount">{cartCount}</span>
          </Link>
        </div>
      </header>
      {menuOpen && (
        <div className="mobile-menu" id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
          <nav aria-label="Mobile navigation">
            <div style={{ padding: '0 0 16px 0', borderBottom: '1px solid var(--line, #e2dcd7)', marginBottom: 12 }}>
              <ShoppingProfileSwitcher isMobile />
            </div>
            <button
              type="button"
              className="mobile-search-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 0',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--line, #e2dcd7)',
                color: 'inherit',
                font: 'inherit',
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
                marginBottom: 8,
              }}
              onClick={() => {
                setMenuOpen(false);
                setSearchOpen(true);
              }}
            >
              <SearchIcon />
              <span>Search collection…</span>
            </button>
            {NAV.map(([to, label]) => (
              <Link key={to} to={to}>{label}</Link>
            ))}
            <Link to="/orders">Orders</Link>
            <Link className="account-link" to={user ? '/account' : '/login'}>{user ? 'Account' : 'Sign in'}</Link>
            {user?.is_admin && <Link to="/admin">Admin studio</Link>}
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      )}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </>
  );
};

export const Footer = () => (
  <>
    <footer className="footer">
      <div>
        <Link className="wordmark" to="/">
          VISHREA <span>STUDIO</span>
        </Link>
        <p>Vishrea Studio is an independent womenswear studio in Bengaluru creating one-of-one pieces and timeless designs — tops, dresses, co-ord sets and layers — with studio pickup and delivery across India.</p>
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted, #666)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--ink, #1a1a1a)', display: 'block', marginBottom: 2 }}>Bengaluru Atelier &amp; Studio</strong>
          <span>16, 4th Cross, Kammasandra Rd, Hebbagodi,</span><br />
          <span>Electronic City Phase 2, Bengaluru, KA 560100</span><br />
          <span>Hours: Mon – Sun, 10:30 AM – 8:30 PM</span><br />
          <a
            href="https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--wine, #681d31)', fontWeight: 500, display: 'inline-block', marginTop: 4 }}
          >
            5.0 ★ (47 Google Reviews) · Open in Google Maps ↗
          </a>
        </div>
      </div>
      <nav className="footer-links" aria-label="Footer">
        <div>
          <h2 className="footer-title">Shop</h2>
          <Link to="/catalogue">All pieces</Link>
          {FOOTER_CATEGORIES.map(([slug, name]) => (
            <Link key={slug} to={`/catalogue/${slug}`}>{name}</Link>
          ))}
        </div>
        <div>
          <h2 className="footer-title">Studio</h2>
          <Link to="/membership">Walkin Wardrobe membership</Link>
          <Link to="/skin-tone">Find your colours</Link>
          <Link to="/gifting">Gifting</Link>
          <Link to="/contact">Help &amp; contact</Link>
        </div>
        <div>
          <h2 className="footer-title">Your account</h2>
          <Link to="/orders">Orders &amp; exchanges</Link>
          <Link to="/account">Account</Link>
          <Link to="/legal/returns">Refunds &amp; exchanges</Link>
          <Link to="/legal/shipping">Shipping &amp; delivery</Link>
          <Link to="/legal/exchange-damage">Damage window</Link>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/terms">Terms</Link>
        </div>
      </nav>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Vishrea Studio · Hebbagodi, Bengaluru</span>
        <span>Prices in INR, including GST</span>
      </div>
    </footer>
    <WhatsAppFloatingButton />
  </>
);
