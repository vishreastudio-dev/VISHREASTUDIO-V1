import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { TheRackProps, CatalogueProduct } from './types';
import './home-sections.css';

const DEFAULT_PRODUCTS: CatalogueProduct[] = [
  { id: 'rack-1', name: 'Wrap Dress', category: 'Dresses', price_inr: 3490, sizes: ['XS', 'S', 'M', 'L', 'XL'], image_url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-2', name: 'The Wine Slip Dress', category: 'Dresses', price_inr: 3990, sizes: ['S', 'M', 'L'], image_url: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-3', name: 'Shirt Dress', category: 'Dresses', price_inr: 2890, sizes: ['XS', 'S', 'M', 'L'], image_url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-4', name: 'Linen Co-ord', category: 'Co-ord Sets', price_inr: 4290, sizes: ['Free Size'], image_url: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-5', name: 'Tailored Set', category: 'Co-ord Sets', price_inr: 4590, sizes: ['S', 'M', 'L', 'XL'], image_url: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-6', name: 'Sculpted Silk Top', category: 'Tops', price_inr: 1890, sizes: ['XS', 'S', 'M', 'L'], image_url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-7', name: 'Knit Ribbed Top', category: 'Tops', price_inr: 2190, sizes: ['S', 'M', 'L'], image_url: 'https://images.unsplash.com/photo-1550614000-4895a10e1bfd?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-8', name: 'Tailored Wide Trousers', category: 'Trousers', price_inr: 2790, sizes: ['S', 'M', 'L', 'XL'], image_url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-9', name: 'Studio Wool Trench', category: 'Outerwear', price_inr: 5890, sizes: ['Free Size'], image_url: 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=85' },
  { id: 'rack-10', name: 'Atelier Fitted Blazer', category: 'Outerwear', price_inr: 4990, sizes: ['S', 'M', 'L'], image_url: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=85' },
];

// SVG Icons (Strictly no emojis)
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? '#7B1426' : 'none'} stroke={filled ? '#7B1426' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const BagIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

function formatINR(val?: number | null): string {
  if (val === null || val === undefined) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

export const TheRack: React.FC<TheRackProps> = ({
  products: initialProducts = [],
  onAddToBag,
  onToggleHeart,
}) => {
  // Use data layer products, falling back cleanly if empty
  const allProducts: CatalogueProduct[] = useMemo(() => {
    return initialProducts.length > 0 ? initialProducts : DEFAULT_PRODUCTS;
  }, [initialProducts]);

  // Derive categories with piece counts
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    allProducts.forEach((p) => {
      const cat = p.category || 'Atelier';
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return [
      { name: 'All pieces', count: allProducts.length },
      ...Array.from(map.entries()).map(([name, count]) => ({ name, count })),
    ];
  }, [allProducts]);

  const [activeCategory, setActiveCategory] = useState('All pieces');
  const [activeHoverId, setActiveHoverId] = useState<string | null>(null);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    if (activeCategory === 'All pieces') return allProducts;
    return allProducts.filter((p) => (p.category || 'Atelier') === activeCategory);
  }, [allProducts, activeCategory]);

  // Detail View State (Lift off the rail modal)
  const [selectedProduct, setSelectedProduct] = useState<CatalogueProduct | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [photoView, setPhotoView] = useState<'front' | 'back'>('front');
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [addedStatus, setAddedStatus] = useState(false);

  // Close modal with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedProduct(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openDetail = (prod: CatalogueProduct) => {
    setSelectedProduct(prod);
    setSelectedSize(prod.sizes?.[0] || 'M');
    setPhotoView('front');
    setAddedStatus(false);
  };

  const closeDetail = () => {
    setSelectedProduct(null);
    setSelectedSize(null);
  };

  // Prev / Next inside modal
  const navigateDetail = useCallback(
    (direction: -1 | 1) => {
      if (!selectedProduct) return;
      const curIdx = filteredProducts.findIndex((p) => p.id === selectedProduct.id);
      if (curIdx === -1) return;
      const nextIdx = (curIdx + direction + filteredProducts.length) % filteredProducts.length;
      const nextProd = filteredProducts[nextIdx];
      setSelectedProduct(nextProd);
      setSelectedSize(nextProd.sizes?.[0] || 'M');
      setPhotoView('front');
      setAddedStatus(false);
    },
    [filteredProducts, selectedProduct]
  );

  const handleAddFromDetail = (e: React.MouseEvent) => {
    if (!selectedProduct || !selectedSize) return;

    // Find variant for selected size or pass product + size
    const variant = selectedProduct.variants?.find(
      (v) => String(v.size_label).toUpperCase() === String(selectedSize).toUpperCase()
    ) || {
      id: `v-${selectedProduct.id}-${selectedSize}`,
      size_label: selectedSize,
      effective_price: selectedProduct.price_inr || 2490,
      stock_quantity: 1,
    };

    onAddToBag?.(selectedProduct, variant, e);

    setAddedStatus(true);
    setTimeout(() => {
      setAddedStatus(false);
    }, 1800);
  };

  const toggleHeart = (id: string, prod: CatalogueProduct) => {
    setLikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
    onToggleHeart?.(id, prod);
  };

  return (
    <section className="vishrea-section" id="rack" aria-labelledby="rack-heading">
      {/* Centered Headline */}
      <div style={{ textAlign: 'center', marginBottom: '36px' }}>
        <h2 id="rack-heading" className="vishrea-headline" style={{ margin: '0 auto' }}>
          Every piece,<br />
          <span className="vishrea-gradient-text">on the rail.</span>
        </h2>
      </div>

      {/* Filter Chips with Counts */}
      <div className="vishrea-chips-row" role="tablist" aria-label="Rail category filters">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.name;
          return (
            <button
              key={cat.name}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`vishrea-chip ${isActive ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(cat.name)}
            >
              <span>{cat.name}</span>
              <em>{cat.count}</em>
            </button>
          );
        })}
      </div>

      {/* The Rail Container */}
      <div className="vishrea-rail-container">
        {/* Thin Chrome Rod */}
        <div className="vishrea-chrome-rod" aria-hidden="true" />

        {/* Track of sliding hangers */}
        <div className="vishrea-hangers-track">
          <div style={{ position: 'relative', width: `${Math.max(filteredProducts.length * 135 + 40, 960)}px`, height: '100%' }}>
            <AnimatePresence>
              {filteredProducts.map((p, idx) => {
                const isHovered = activeHoverId === p.id;
                const leftOffset = idx * 135 + 20;

                return (
                  <motion.div
                    key={p.id}
                    layout
                    layoutId={`hanger-${p.id}`}
                    initial={{ opacity: 0, scale: 0.8, y: -20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.7, y: 20 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 26 }}
                    className="vishrea-hanger-unit"
                    style={{ left: `${leftOffset}px` }}
                    onMouseEnter={() => setActiveHoverId(p.id)}
                    onMouseLeave={() => setActiveHoverId(null)}
                    onClick={() => openDetail(p)}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${p.name}`}
                  >
                    {/* Wooden Hanger: Hook + Bar */}
                    <span className="vishrea-hanger-hook" aria-hidden="true" />
                    <span className="vishrea-hanger-bar" aria-hidden="true" />

                    {/* Hanging Garment Card */}
                    <motion.span
                      layoutId={`garment-image-${p.id}`}
                      className="vishrea-hanger-garment"
                      style={{
                        backgroundImage: `url(${p.image_url || p.images?.[0] || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400'})`,
                      }}
                    />

                    {/* Floating caption below on hover */}
                    <div className="vishrea-hanger-caption" style={{ opacity: isHovered ? 1 : 0 }}>
                      <div>{p.name}</div>
                      <div style={{ color: '#C9984A', marginTop: '2px' }}>{formatINR(p.price_inr)}</div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Captions bottom: "Explore the collection · N pieces" */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginTop: '36px',
          paddingTop: '16px',
          borderTop: '1px solid var(--vishrea-line)',
          fontSize: '0.75rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vishrea-soft)',
        }}
      >
        <span>Explore the collection · {filteredProducts.length} pieces</span>
        <span>Photos: Unsplash (Free under the Unsplash License)</span>
      </div>

      {/* Morphing Detail View Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            className="vishrea-rail-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDetail}
          >
            <motion.div
              layoutId={`hanger-${selectedProduct.id}`}
              className="vishrea-modal-inner"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            >
              {/* Close Button */}
              <button
                type="button"
                className="vishrea-modal-close"
                onClick={closeDetail}
                aria-label="Close piece details"
              >
                <span>Close</span>
                <CloseIcon />
              </button>

              {/* Prev / Next Arrows */}
              <button
                type="button"
                className="vishrea-ic-btn"
                style={{ position: 'absolute', left: '-22px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateDetail(-1);
                }}
                aria-label="Previous piece"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="vishrea-ic-btn"
                style={{ position: 'absolute', right: '-22px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateDetail(1);
                }}
                aria-label="Next piece"
              >
                <ChevronRightIcon />
              </button>

              {/* Left Column: Morphed Photo with Front/Back Toggle */}
              <div>
                <motion.div
                  layoutId={`garment-image-${selectedProduct.id}`}
                  className="vishrea-modal-photo"
                  style={{
                    backgroundImage: `url(${
                      photoView === 'front'
                        ? selectedProduct.image_url || selectedProduct.images?.[0]
                        : selectedProduct.images?.[1] || selectedProduct.image_url
                    })`,
                  }}
                >
                  {/* Front/Back toggle */}
                  <div className="vishrea-modal-photo-toggle">
                    <button
                      type="button"
                      className={photoView === 'front' ? 'is-active' : ''}
                      onClick={() => setPhotoView('front')}
                    >
                      Front
                    </button>
                    <button
                      type="button"
                      className={photoView === 'back' ? 'is-active' : ''}
                      onClick={() => setPhotoView('back')}
                    >
                      Back
                    </button>
                  </div>
                </motion.div>
              </div>

              {/* Right Column: Piece Details */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: '#C9984A',
                    fontWeight: 600,
                    marginBottom: '8px',
                  }}
                >
                  VISHRÉA · {selectedProduct.category?.toUpperCase() || 'COLLECTION'}
                </span>

                {/* Name in spaced capitals */}
                <h3
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 800,
                    fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
                    lineHeight: 1.1,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--vishrea-ink)',
                    margin: '0 0 12px 0',
                  }}
                >
                  {selectedProduct.name}
                </h3>

                {/* Price */}
                <div
                  style={{
                    fontSize: '1.4rem',
                    fontWeight: 700,
                    color: '#7B1426',
                    marginBottom: '16px',
                  }}
                >
                  {formatINR(selectedProduct.price_inr)}
                </div>

                {/* Size Chips */}
                <div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--vishrea-soft)',
                      fontWeight: 600,
                    }}
                  >
                    Select Size:
                  </span>
                  <div className="vishrea-size-grid">
                    {(selectedProduct.sizes?.length ? selectedProduct.sizes : ['XS', 'S', 'M', 'L', 'XL']).map((sz) => {
                      const isSel = selectedSize === sz;
                      return (
                        <button
                          key={sz}
                          type="button"
                          className={`vishrea-size-chip ${isSel ? 'is-selected' : ''}`}
                          onClick={() => setSelectedSize(sz)}
                          aria-label={`Size ${sz}`}
                        >
                          {sz}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Actions: Add to Bag Pill + Heart */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '12px' }}>
                  <button
                    type="button"
                    className="vishrea-pill-btn"
                    style={{ flex: 1, minHeight: '50px' }}
                    onClick={handleAddFromDetail}
                    disabled={!selectedSize}
                  >
                    <BagIcon />
                    <span>
                      {!selectedSize
                        ? 'SELECT A SIZE'
                        : addedStatus
                        ? 'ADDED TO WARDROBE BAG'
                        : 'ADD TO WARDROBE BAG'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`vishrea-ic-btn ${likedMap[selectedProduct.id] ? 'active-heart' : ''}`}
                    style={{ width: '50px', height: '50px' }}
                    onClick={() => toggleHeart(selectedProduct.id, selectedProduct)}
                    aria-label={likedMap[selectedProduct.id] ? 'Remove from wishlist' : 'Add to wishlist'}
                  >
                    <HeartIcon filled={Boolean(likedMap[selectedProduct.id])} />
                  </button>
                </div>

                {/* "See availability" link */}
                <div style={{ marginTop: '22px' }}>
                  <Link
                    to={`/product/${encodeURIComponent(selectedProduct.slug || selectedProduct.id)}`}
                    style={{
                      fontSize: '0.78rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--vishrea-ink)',
                      textDecoration: 'underline',
                      fontWeight: 600,
                    }}
                  >
                    See availability & atelier notes →
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
