import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { ErrorState, InlineMessage, LoadingState } from '../components/Status';
import { imageFor } from '../lib/imageFor';
import { api, formatINR } from '../lib/api';
import { useApi } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { describeProduct, measurementText, productFaqs } from '../lib/productCopy';
import { faqSchema } from '../lib/schema';
import { absoluteUrl } from '../site.config';
import { NotFound } from './NotFound';

const STOCK_COPY = {
  one_of_one: 'In stock — this is the only one',
  low: 'In stock — only a few left',
  in_stock: 'In stock',
  sold_out: 'This size is sold out',
};

export const ProductDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { addToCart, cartBusy, cart, user, activeSizeProfile } = useStore();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const { data, error, loading, reload } = useApi(`/api/product?slug=${encodeURIComponent(slug)}`, { maxAge: 15_000 });
  const product = data?.product || null;
  const variants = useMemo(() => product?.variants || [], [product]);

  const matchingVariant = useMemo(() => {
    if (!variants.length || !activeSizeProfile) return null;
    const target = (activeSizeProfile.category_sizes?.[product?.category_slug] || activeSizeProfile.clothing_size || 'M').toUpperCase();
    return variants.find((v) => v.size_label && String(v.size_label).toUpperCase() === target) || null;
  }, [variants, activeSizeProfile, product?.category_slug]);

  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(1);
  const [activeThumb, setActiveThumb] = useState(0);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const preferredId = matchingVariant && matchingVariant.in_stock ? matchingVariant.id : (variants.find((v) => v.in_stock) || null)?.id;
    setVariantId(variants.length === 1 ? variants[0].id : preferredId || null);
    setQty(1);
    setActiveThumb(0);
    setMsg({ tone: 'info', text: '' });
  }, [product?.id, matchingVariant]);

  const selected = useMemo(() => variants.find((v) => v.id === variantId) || null, [variants, variantId]);
  const maxQty = selected ? Math.max(1, selected.available_quantity) : 1;

  // Check if selected variant is already in the cart (guest or logged-in)
  const cartItem = useMemo(() => {
    if (!selected) return null;
    return cart.find((item) => item.variant_id === selected.id) || null;
  }, [cart, selected]);
  const alreadyInCart = Boolean(cartItem);

  // Check if another variant/size of this piece is already in the cart
  const otherVariantInCart = useMemo(() => {
    if (!variants?.length || alreadyInCart) return null;
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const found = cart.find((item) => variantMap.has(item.variant_id));
    return found ? variantMap.get(found.variant_id) : null;
  }, [cart, variants, alreadyInCart]);

  const breadcrumbs = useMemo(
    () =>
      product
        ? [
            { name: 'Home', url: '/' },
            { name: 'Shop', url: '/catalogue' },
            ...(product.category_slug ? [{ name: product.category, url: `/catalogue/${product.category_slug}` }] : []),
            { name: product.name, url: `/product/${product.slug}` },
          ]
        : null,
    [product]
  );
  const faqNode = useMemo(() => (product ? faqSchema(absoluteUrl(`/product/${product.slug}`), productFaqs(product)) : null), [product]);
  usePageSeo({
    title: product ? `${product.name}${product.category ? ` — ${product.category}` : ''} | Vishrea Studio` : undefined,
    canonical: product ? `/product/${product.slug}` : undefined,
    ogImage: product?.image_url,
    breadcrumbs,
    product,
    schema: faqNode,
    ready: Boolean(product),
  });

  if (loading && !product) {
    return (
      <div>
        <Header />
        <LoadingState label="Loading piece…" minHeight="60vh" />
        <Footer />
      </div>
    );
  }
  if (error?.status === 404) return <NotFound />;
  if (error && !product) {
    return (
      <div>
        <Header />
        <ErrorState error={error} onRetry={reload} />
        <Footer />
      </div>
    );
  }
  if (!product) return null;

  const heroImage = imageFor(product);
  const gallery = product.images?.length ? product.images : [heroImage];
  const soldOut = !product.available;
  const priceNow = selected ? selected.effective_price : product.price_inr;
  const comparePrice = selected ? (selected.effective_price < selected.price_inr ? selected.price_inr : null) : product.compare_at_price;

  const saveToWardrobe = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/product/${product.slug}`)}`);
      return;
    }
    setSaving(true);
    try {
      await api('/api/wardrobe', { method: 'POST', body: { action: 'save', product_id: product.id } });
      setSavedId(product.id);
      setMsg({ tone: 'success', text: 'Saved to your Wardrobe Bag.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const add = async (thenGo) => {
    if (adding) return;
    if (!selected) {
      setMsg({ tone: 'error', text: 'Please choose a size first.' });
      return;
    }
    if (!selected.in_stock) {
      setMsg({ tone: 'error', text: 'That size is sold out.' });
      return;
    }
    setAdding(true);
    setMsg({ tone: 'info', text: '' });
    try {
      await addToCart({ product, variant: selected, quantity: qty });
      if (thenGo) navigate(thenGo);
      else setMsg({ tone: 'success', text: 'Added to your bag.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
      if (err.code === 'out_of_stock' || err.code === 'product_unavailable') reload();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <Header />
      <main id="main-content" className="pdp-v2">
        <nav aria-label="Breadcrumb" className="pdp-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link to="/catalogue">Shop</Link>
          {product.category_slug && (
            <>
              <span aria-hidden="true">/</span>
              <Link to={`/catalogue/${product.category_slug}`}>{product.category}</Link>
            </>
          )}
          <span aria-hidden="true">/</span>
          <strong aria-current="page">{product.name}</strong>
        </nav>

        <div className="pdp-v2-grid">
          <section className={`pdp-media${gallery.length > 1 ? '' : ' single'}`} aria-label="Product images">
            {gallery.length > 1 && <div className="pdp-thumbs-v2">
              {gallery.map((img, i) => (
                <button key={img + i} className={`pdp-thumb-v2 ${activeThumb === i ? 'active' : ''}`} type="button" onClick={() => setActiveThumb(i)} aria-label={`View image ${i + 1} of ${gallery.length}`} aria-pressed={activeThumb === i}>
                  <img src={img} alt="" width="60" height="75" loading="lazy" />
                </button>
              ))}
            </div>}
            <div className="pdp-main-v2">
              <img
                id="pdpMainImage"
                src={gallery[activeThumb] || heroImage}
                alt={`${product.name}${product.color ? ` in ${product.color.toLowerCase()}` : ''}${gallery.length > 1 ? `, view ${activeThumb + 1} of ${gallery.length}` : ''}`}
                loading="eager"
                fetchPriority="high"
                width="600"
                height="800"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = '/assets/editorial.jpg';
                }}
              />
            </div>
          </section>

          <section className="pdp-info-v2">
            <div className="pdp-kicker-row">
              <p className="eyebrow">{product.category || 'Vishrea Studio'}</p>
              {soldOut ? <span className="pdp-badge-v2 is-sold-out">Sold out</span> : product.badge && <span className="pdp-badge-v2">{product.badge}</span>}
            </div>
            <h1>{product.name}</h1>
            <div className="pdp-price-v2" aria-live="polite">
              {priceNow !== null && priceNow !== undefined ? formatINR(priceNow) : 'Price on request'}
              {comparePrice ? <span className="price-compare">{formatINR(comparePrice)}</span> : null}
            </div>
            <p className="pdp-tax">Price includes GST</p>
            <p className="pdp-copy-v2">{describeProduct(product)}</p>

            <p className={`pdp-stock ${soldOut || (selected && !selected.in_stock) ? 'is-out' : ''}`} aria-live="polite">
              {soldOut ? 'Sold out' : selected ? STOCK_COPY[selected.stock_state] : 'Choose a size to see availability'}
            </p>

            {activeSizeProfile && (
              <div
                style={{
                  background: '#faf6f4',
                  border: '1px solid var(--line, #e2dcd7)',
                  padding: '10px 14px',
                  marginBottom: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span>
                  {matchingVariant ? (
                    <>
                      Your Profile Match: <strong style={{ color: 'var(--wine, #752238)' }}>{matchingVariant.size_label}</strong> ({activeSizeProfile.name})
                    </>
                  ) : (
                    <>
                      Saved Size for {activeSizeProfile.name}: <strong style={{ color: 'var(--wine, #752238)' }}>{activeSizeProfile.category_sizes?.[product.category_slug] || activeSizeProfile.clothing_size || 'M'}</strong>
                    </>
                  )}
                </span>
                <Link to="/account#size-profiles" className="text-link" style={{ fontSize: 11 }}>
                  Switch profile
                </Link>
              </div>
            )}

            {variants.length > 0 && (
              <fieldset className="pdp-option-v2" style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="pdp-option-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <legend>{variants.length === 1 ? 'Size' : 'Choose a size'}</legend>
                  <button
                    type="button"
                    className="text-link"
                    style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: 0, padding: 0 }}
                    onClick={() => setSizeGuideOpen(true)}
                  >
                    Size Guide 📏
                  </button>
                </div>
                <div className="size-grid-v2" role="radiogroup" aria-label="Size">
                  {variants.map((v) => {
                    const inBag = cart.some((item) => item.variant_id === v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        role="radio"
                        aria-checked={variantId === v.id}
                        disabled={!v.in_stock}
                        className={`${variantId === v.id ? 'selected' : ''} ${v.in_stock ? '' : 'unavailable'} ${inBag ? 'has-in-bag' : ''}`}
                        onClick={() => {
                          setVariantId(v.id);
                          setQty(1);
                          setMsg({ tone: 'info', text: '' });
                        }}
                        title={`${v.size_label} · ${formatINR(v.effective_price)}${v.in_stock ? '' : ' · sold out'}${inBag ? ' (Already in bag)' : ''}`}
                      >
                        {v.size_label}
                        {inBag && <span className="size-bag-dot" title="Already in bag" />}
                      </button>
                    );
                  })}
                </div>
                {selected && (
                  <div className="variant-meta">
                    <span>SKU {selected.sku}</span>
                    {Object.entries(selected.attributes || {}).map(([k, val]) => (
                      <span key={k}>{k}: {val}</span>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {selected && !product.is_one_of_one && selected.in_stock && maxQty > 1 && (
              <div style={{ margin: '14px 0' }}>
                <span className="visually-hidden" id="qty-label">Quantity</span>
                <div className="qty-stepper" role="group" aria-labelledby="qty-label">
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
                  <span aria-live="polite">{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} aria-label="Increase quantity">+</button>
                </div>
              </div>
            )}

            {alreadyInCart && (
              <div className="pdp-in-bag-banner" role="status">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  {cartItem?.quantity > 1
                    ? `${cartItem.quantity} pieces of this are in your bag.`
                    : 'This piece is already in your bag.'}
                </span>
                <Link to="/cart" className="pdp-in-bag-link">View bag →</Link>
              </div>
            )}
            {otherVariantInCart && (
              <div className="pdp-in-bag-banner pdp-in-bag-hint" role="status">
                <span>Size {otherVariantInCart.size_label} of this piece is already in your bag.</span>
                <Link to="/cart" className="pdp-in-bag-link">View bag →</Link>
              </div>
            )}

            <div className="pdp-actions-v2" style={{ gridTemplateColumns: '1fr' }}>
              {alreadyInCart ? (
                <Link to="/cart" className="button button-dark add-pdp-v2 in-bag-btn">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ marginRight: 8 }}><polyline points="20 6 9 17 4 12"/></svg>
                  In your bag · Proceed to checkout
                </Link>
              ) : (
                <button type="button" className="button button-dark add-pdp-v2" disabled={soldOut || adding || cartBusy || (selected && !selected.in_stock)} onClick={() => add(null)}>
                  {soldOut ? 'Sold out' : adding ? 'Adding…' : 'Add to bag'}
                </button>
              )}
            </div>
            {alreadyInCart ? (
              <Link to="/cart" className="pdp-buy-now" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                View bag &amp; checkout →
              </Link>
            ) : !soldOut && (
              <button className="pdp-buy-now" type="button" disabled={adding || cartBusy} onClick={() => add('/cart')}>
                Buy now
              </button>
            )}
            {savedId === product.id ? (
              <Link to="/wardrobe" className="pdp-save" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                In your Wardrobe Bag · View →
              </Link>
            ) : (
            <button type="button" className="pdp-save" disabled={saving} onClick={saveToWardrobe}>
              {saving ? 'Saving…' : 'Save to Wardrobe Bag'}
            </button>
            )}
            {!(alreadyInCart && msg.tone === 'success') && <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>}

            <div className="detail-accordion-v2">
              <details open>
                <summary>Details</summary>
                <dl className="pdp-facts">
                  {[
                    ['Category', product.category],
                    ['Colour', product.color],
                    ['Material', product.material],
                    ['Sizes', variants.length ? variants.map((v) => `${v.size_label}${v.in_stock ? '' : ' (sold out)'}`).join(', ') : null],
                    ['SKU', selected?.sku],
                    ['Measurements', measurementText(product)],
                    ['Availability', product.is_one_of_one ? 'One of one — not restocked' : null],
                    ...Object.entries(product.attributes || {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]),
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                </dl>
              </details>
              {product.care_instructions && (
                <details>
                  <summary>Care</summary>
                  <p>{product.care_instructions}</p>
                </details>
              )}
              <details>
                <summary>Delivery &amp; exchanges</summary>
                <p>
                  Delivery anywhere in India is ₹99, usually dispatched within 48 hours. Studio pickup in Bengaluru is free. Size exchanges can be requested from your order page within 7 days of delivery; report any damage within 24 hours.{' '}
                  <Link to="/contact">More answers</Link>
                </p>
              </details>
              <details>
                <summary>Questions</summary>
                <dl className="pdp-faq">
                  {productFaqs(product).map((f) => (
                    <div key={f.q}>
                      <dt>{f.q}</dt>
                      <dd>{f.a}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          </section>
        </div>
      </main>

      {data?.recommendations?.length > 0 && (
        <section className="section recommendation-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">You may also like</p>
              <h2>{product.category ? `More ${product.category.toLowerCase()} and pieces to pair` : 'More from the studio'}</h2>
            </div>
            <Link className="text-link" to={product.category_slug ? `/catalogue/${product.category_slug}` : '/catalogue'}>
              {product.category ? `All ${product.category.toLowerCase()}` : 'Shop all'} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="product-grid">
            {data.recommendations.map((x) => (
              <ProductCard key={x.id} product={x} />
            ))}
          </div>
        </section>
      )}

      {/* SIZE GUIDE MODAL */}
      {sizeGuideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="size-guide-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26, 23, 25, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 2000,
          }}
          onClick={(e) => e.target === e.currentTarget && setSizeGuideOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              maxWidth: 600,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '28px 24px',
              border: '1px solid var(--line, #e2dcd7)',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.2)',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <span style={{ fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--wine, #752238)', fontWeight: 600 }}>
                  Vishrea Studio Fit Guide
                </span>
                <h3 id="size-guide-title" style={{ fontFamily: 'Georgia, serif', fontSize: 22, margin: '4px 0 0', fontWeight: 400 }}>
                  {product.category || 'Clothing'} Size Guide
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSizeGuideOpen(false)}
                style={{ background: 'none', border: 0, fontSize: 24, lineHeight: 1, cursor: 'pointer', color: 'var(--ink, #1a1719)', padding: '2px 6px' }}
                aria-label="Close size guide"
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 16 }}>
              {product.size_notes || (product.fit_type ? `Fit profile: ${product.fit_type.charAt(0).toUpperCase() + product.fit_type.slice(1)}. ` : '')}
              {product.one_size_fit_range ? `One-size range: ${product.one_size_fit_range}. ` : ''}
              Body measurements below are given in centimeters. If you fall between sizes, select based on your desired fit style.
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left', marginBottom: 20 }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #1a1719', background: '#faf8f6' }}>
                  <th style={{ padding: '8px 10px' }}>Size</th>
                  <th style={{ padding: '8px 10px' }}>Bust (cm)</th>
                  <th style={{ padding: '8px 10px' }}>Waist (cm)</th>
                  <th style={{ padding: '8px 10px' }}>Hips (cm)</th>
                  <th style={{ padding: '8px 10px' }}>UK</th>
                  <th style={{ padding: '8px 10px' }}>US</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { s: 'XS', b: '80–84', w: '62–66', h: '88–92', uk: '6', us: '2' },
                  { s: 'S', b: '85–89', w: '67–71', h: '93–97', uk: '8', us: '4' },
                  { s: 'M', b: '90–94', w: '72–76', h: '98–102', uk: '10', us: '6' },
                  { s: 'L', b: '95–100', w: '77–83', h: '103–108', uk: '12', us: '8' },
                  { s: 'XL', b: '101–107', w: '84–90', h: '109–115', uk: '14', us: '10' },
                  { s: 'XXL', b: '108–114', w: '91–97', h: '116–122', uk: '16', us: '12' },
                ].map((row) => (
                  <tr key={row.s} style={{ borderBottom: '1px solid var(--line, #e2dcd7)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.s}</td>
                    <td style={{ padding: '8px 10px' }}>{row.b}</td>
                    <td style={{ padding: '8px 10px' }}>{row.w}</td>
                    <td style={{ padding: '8px 10px' }}>{row.h}</td>
                    <td style={{ padding: '8px 10px' }}>{row.uk}</td>
                    <td style={{ padding: '8px 10px' }}>{row.us}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ background: '#faf6f4', border: '1px solid #e8e2dd', padding: 14, fontSize: 12, lineHeight: 1.6 }}>
              <strong style={{ display: 'block', color: 'var(--wine, #752238)', marginBottom: 4 }}>Bespoke Studio Guarantee</strong>
              Most Vishrea Studio pieces are one-of-one handcrafted garments. If your piece arrives and does not fit to your liking, exchange requests are accepted within 7 days of delivery.
            </div>

            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button
                type="button"
                className="button button-dark"
                style={{ padding: '10px 24px', fontSize: 11 }}
                onClick={() => setSizeGuideOpen(false)}
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
};
