import React, { useState, useMemo } from 'react';
import { ArcEngine } from './ArcEngine';
import type { TheOccasionEditProps, OccasionItem } from './types';
import './home-sections.css';

const DEFAULT_OCCASION_ITEMS: OccasionItem[] = [
  {
    id: 'occ-1',
    name: 'The Wine Slip Dress',
    occasion: 'Wedding Guest',
    material: 'Fluid Silk Satin',
    note: 'Bias-cut column silhouette',
    price_inr: 3990,
    image_url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=800&q=85',
    tag: 'LIMITED ATELIER',
  },
  {
    id: 'occ-2',
    name: 'After Hours Co-ord',
    occasion: 'Cocktail',
    material: 'Textured Crepe',
    note: 'Tailored drape trousers & top',
    price_inr: 4590,
    image_url: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=85',
  },
  {
    id: 'occ-3',
    name: 'Ivory Column Silhouette',
    occasion: 'Festive & Gala',
    material: 'Pure Handloom Silk',
    note: 'One of one bespoke Bangalore piece',
    price_inr: 5200,
    image_url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=85',
    tag: '1 OF 1',
  },
  {
    id: 'occ-4',
    name: 'Dusk Tailored Trench',
    occasion: 'Reception',
    material: 'Fine Twill',
    note: 'Double-breasted structured lapel',
    price_inr: 4990,
    image_url: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=85',
  },
  {
    id: 'occ-5',
    name: 'Velvet Midnight Gown',
    occasion: 'Date Night',
    material: 'Rich Micro-Velvet',
    note: 'Sculpted cowl neckline',
    price_inr: 4290,
    image_url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=85',
    tag: 'NEW ARRIVAL',
  },
];

// SVG Icons (Strictly no emojis)
const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

export const TheOccasionEdit: React.FC<TheOccasionEditProps> = ({
  items: customItems,
  products = [],
  onAddToBag,
  onToggleHeart,
  onSelectProduct,
}) => {
  // Bind to data layer products if available
  const items: OccasionItem[] = useMemo(() => {
    if (customItems && customItems.length >= 5) {
      return customItems;
    }

    if (products.length >= 5) {
      return products.slice(0, 5).map((p, idx) => ({
        id: p.id,
        name: p.name,
        occasion: p.occasion || DEFAULT_OCCASION_ITEMS[idx].occasion,
        material: p.material || DEFAULT_OCCASION_ITEMS[idx].material,
        note: p.size_notes || DEFAULT_OCCASION_ITEMS[idx].note,
        price_inr: p.price_inr || DEFAULT_OCCASION_ITEMS[idx].price_inr,
        image_url: p.image_url || p.images?.[0] || DEFAULT_OCCASION_ITEMS[idx].image_url,
        tag: p.badge || (p.is_one_of_one ? '1 OF 1' : DEFAULT_OCCASION_ITEMS[idx].tag || null),
        product: p,
      }));
    }

    return DEFAULT_OCCASION_ITEMS;
  }, [customItems, products]);

  const [activeIdx, setActiveIdx] = useState(2);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [addedStatus, setAddedStatus] = useState(false);

  const currentItem = items[activeIdx] || items[0];

  const handleAdd = (e: React.MouseEvent) => {
    onAddToBag?.(currentItem.product || currentItem, e);
    setAddedStatus(true);
    setTimeout(() => {
      setAddedStatus(false);
    }, 1800);
  };

  const handleToggleHeart = () => {
    const id = currentItem.id;
    setLikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
    onToggleHeart?.(id, currentItem.product || currentItem);
  };

  return (
    <section className="vishrea-section" id="occasion" aria-labelledby="occasion-heading">
      {/* Centered Headline with Line */}
      <div style={{ textAlign: 'center', marginBottom: '36px' }}>
        <p className="vishrea-sub" style={{ margin: '0 auto 8px' }}>
          For the occasions that matter
        </p>
        <h2 id="occasion-heading" className="vishrea-headline" style={{ margin: '0 auto' }}>
          The Occasion <span className="vishrea-gradient-text">Edit</span>
        </h2>
      </div>

      {/* Curved Arc of Tall Arch-topped Cards */}
      <ArcEngine
        items={items}
        activeIndex={activeIdx}
        onChange={(idx) => {
          setActiveIdx(idx);
          setAddedStatus(false);
        }}
        gap={240}
        lift={14}
        rot={6}
        fade={0.14}
        blur={false}
        centreScale={1.05}
        stageHeight={500}
        ariaLabel="The Occasion Edit carousel"
        onItemClick={(item) => onSelectProduct?.(item.product || item)}
        renderItem={(item, k, { isActive }) => (
          <div
            className={`vishrea-occ-card ${isActive ? 'is-center' : ''}`}
            style={{
              borderColor: isActive ? '#C9984A' : 'transparent',
            }}
          >
            {/* Optional Small Tag on Card (only if data has one) */}
            {item.tag && (
              <span className="vishrea-occ-tag">
                {item.tag}
              </span>
            )}

            {/* Arch-topped Inner Photo */}
            <div
              className="vishrea-occ-inner"
              style={{
                backgroundImage: `url(${item.image_url})`,
              }}
            >
              <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', color: '#ffffff' }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#C9984A',
                    fontWeight: 600,
                  }}
                >
                  {item.occasion}
                </span>
              </div>
            </div>
          </div>
        )}
      />

      {/* Meta Below Centre Card: Name, Fabric/Note, Price in Gold */}
      <div className="vishrea-occ-meta">
        <h3 className="vishrea-occ-title">{currentItem.name}</h3>
        <p className="vishrea-occ-note">
          {currentItem.material}
          {currentItem.note ? ` · ${currentItem.note}` : ''}
        </p>
        <div className="vishrea-occ-price">
          {formatINR(currentItem.price_inr)}
        </div>
      </div>

      {/* Controls: Prev, Add to Bag, Heart, Next */}
      <div className="vishrea-occ-controls">
        <button
          type="button"
          className="vishrea-ic-btn"
          onClick={() => setActiveIdx((prev) => (prev - 1 + items.length) % items.length)}
          aria-label="Previous occasion look"
        >
          <ChevronLeftIcon />
        </button>

        <button
          type="button"
          className="vishrea-pill-btn"
          onClick={handleAdd}
          style={{ padding: '14px 32px' }}
        >
          <BagIcon />
          <span>{addedStatus ? 'ADDED TO BAG' : 'ADD TO WARDROBE BAG'}</span>
        </button>

        <button
          type="button"
          className={`vishrea-ic-btn ${likedMap[currentItem.id] ? 'active-heart' : ''}`}
          onClick={handleToggleHeart}
          aria-label={likedMap[currentItem.id] ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <HeartIcon filled={Boolean(likedMap[currentItem.id])} />
        </button>

        <button
          type="button"
          className="vishrea-ic-btn"
          onClick={() => setActiveIdx((prev) => (prev + 1) % items.length)}
          aria-label="Next occasion look"
        >
          <ChevronRightIcon />
        </button>
      </div>
    </section>
  );
};
