import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArcEngine } from './ArcEngine';
import type { TryTheLookProps, LookItem, LookPiece } from './types';
import './home-sections.css';

// SVG Icons (Strictly SVG icons only, no emojis)
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

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? '#7B1426' : 'none'} stroke={filled ? '#7B1426' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// High-resolution model editorial photos
const MODEL_LOOK_PHOTOS = [
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1550614000-4895a10e1bfd?auto=format&fit=crop&w=800&q=85',
  'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85',
];

const LOOK_NAMES = [
  'Everyday Atelier',
  'Studio Fluidity',
  'City Tailored',
  'Brunch Drape',
  'Dusk Velvet',
  'Weekend Respite',
  'Occasion Silhouette',
  'Sculpted Modernist',
];

const DEFAULT_PIECE_ROLES = ['Top', 'Trousers', 'Jacket', 'Bag', 'Earrings', 'Shoes'];

function formatINR(val?: number | null): string {
  if (val === null || val === undefined) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

export const TryTheLook: React.FC<TryTheLookProps> = ({
  looks: customLooks,
  products = [],
  onAddToBag,
  onAddFullLook,
  onToggleHeart,
  onSelectPiece,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [addedLookup, setAddedLookup] = useState<Record<string, boolean>>({});
  const [fullLookAdded, setFullLookAdded] = useState(false);

  // Generate 8 curated looks bound to the data layer products
  const looks: LookItem[] = useMemo(() => {
    if (customLooks && customLooks.length >= 8) {
      return customLooks.slice(0, 8);
    }

    return LOOK_NAMES.map((name, lookIdx) => {
      // Map products from the data layer into the pieces list for each look
      const pieces: LookPiece[] = DEFAULT_PIECE_ROLES.map((role, roleIdx) => {
        const prodIndex = (lookIdx * 2 + roleIdx) % Math.max(1, products.length);
        const prod = products[prodIndex];

        return {
          id: prod ? `prod-${prod.id}-${roleIdx}` : `look-${lookIdx}-piece-${roleIdx}`,
          name: prod?.name || `${name} ${role}`,
          role,
          category: prod?.category || 'Vishrea Studio',
          price_inr: prod?.price_inr || 2490 + ((lookIdx + roleIdx) % 5) * 600,
          image_url: prod?.image_url || prod?.images?.[0] || null,
          color: prod?.color || '#7B1426',
          product: prod,
        };
      });

      return {
        id: `look-${lookIdx + 1}`,
        name,
        tagline: 'Styled head to toe in Bengaluru',
        modelImage: MODEL_LOOK_PHOTOS[lookIdx % MODEL_LOOK_PHOTOS.length],
        pieces,
      };
    });
  }, [customLooks, products]);

  const currentLook = looks[activeIdx] || looks[0];

  const toggleHeart = (id: string, piece?: LookPiece) => {
    setLikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
    onToggleHeart?.(id, piece);
  };

  const handleAddPiece = (piece: LookPiece, e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToBag?.(piece, e);

    // Visual feedback
    setAddedLookup((prev) => ({ ...prev, [piece.id]: true }));
    setTimeout(() => {
      setAddedLookup((prev) => ({ ...prev, [piece.id]: false }));
    }, 1200);
  };

  const handleAddFullLook = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAddFullLook) {
      onAddFullLook(currentLook.pieces, e);
    } else if (onAddToBag) {
      currentLook.pieces.forEach((piece) => onAddToBag(piece, e));
    }

    setFullLookAdded(true);
    setTimeout(() => {
      setFullLookAdded(false);
    }, 1800);
  };

  return (
    <section className="vishrea-section" id="shop" aria-labelledby="try-the-look-heading">
      {/* Section Head matching Render "Just in" content with new UI */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '36px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ display: 'inline-block', width: '20px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
            <p className="vishrea-sub" style={{ margin: 0 }}>JUST IN · STYLED HEAD TO TOE</p>
          </div>
          <h2 id="try-the-look-heading" className="vishrea-headline">
            New <span className="vishrea-gradient-text">arrivals</span>
          </h2>
          <p className="vishrea-sub" style={{ marginTop: '8px', maxWidth: '44ch', textTransform: 'none', fontSize: '0.92rem' }}>
            Curated pieces, styled head to toe. Explore full looks or add individual pieces.
          </p>
        </div>

        <Link
          className="vishrea-pill-btn"
          to="/catalogue?sort=newest"
          style={{ textDecoration: 'none' }}
        >
          <span>SEE EVERYTHING NEW</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="vishrea-look-grid">
        {/* Left Column: Arc Stage with 8 Model Cutouts */}
        <div>
          <ArcEngine
            items={looks}
            activeIndex={activeIdx}
            onChange={(idx) => {
              setActiveIdx(idx);
              setFullLookAdded(false);
            }}
            gap={260}
            lift={0}
            rot={0}
            fade={0.3}
            blur={2}
            centreScale={1.05}
            stageHeight={480}
            ariaLabel="Model looks arc carousel"
            renderItem={(look, k, { isActive }) => (
              <div
                style={{
                  width: '240px',
                  height: '430px',
                  borderRadius: '20px',
                  boxShadow: isActive
                    ? '0 20px 40px -10px rgba(123, 20, 38, 0.22), 0 8px 24px rgba(0, 0, 0, 0.12)'
                    : '0 10px 24px -8px rgba(0, 0, 0, 0.14)',
                  backgroundImage: `url(${look.modelImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center top',
                  position: 'relative',
                  overflow: 'hidden',
                  border: isActive ? '1.5px solid rgba(201, 152, 74, 0.5)' : '1px solid rgba(0, 0, 0, 0.06)',
                  backgroundColor: '#f6f1e7',
                }}
              >
                {/* Subtle gradient vignette at bottom */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 'auto 0 0 0',
                    height: '35%',
                    background: 'linear-gradient(to top, rgba(20, 16, 16, 0.75), transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    padding: '16px',
                    color: '#ffffff',
                  }}
                >
                  <span style={{ fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C9984A' }}>
                    Look 0{k + 1}
                  </span>
                  <strong style={{ fontSize: '1.05rem', fontWeight: 600 }}>{look.name}</strong>
                </div>
              </div>
            )}
          />

          {/* Controls: Counter, Navigation Arrows, Hint */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              marginTop: '20px',
              padding: '0 8px',
            }}
          >
            {/* Arrows */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="vishrea-ic-btn"
                onClick={() => setActiveIdx((prev) => (prev - 1 + looks.length) % looks.length)}
                aria-label="Previous look"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="vishrea-ic-btn"
                onClick={() => setActiveIdx((prev) => (prev + 1) % looks.length)}
                aria-label="Next look"
              >
                <ChevronRightIcon />
              </button>
            </div>

            {/* Counter: "3 of 8 · Look name" */}
            <div
              style={{
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--vishrea-ink)',
                letterSpacing: '0.04em',
                textAlign: 'center',
              }}
            >
              {activeIdx + 1} of {looks.length} · {currentLook.name}
            </div>

            {/* Hint */}
            <div
              style={{
                fontSize: '0.75rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--vishrea-soft)',
              }}
            >
              Scroll or drag
            </div>
          </div>
        </div>

        {/* Right Column: "In this look" Panel */}
        <div className="vishrea-look-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              In this look
            </h3>
            <span style={{ fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C9984A', fontWeight: 600 }}>
              {currentLook.pieces.length} Pieces
            </span>
          </div>

          <ul style={{ padding: 0, margin: 0 }}>
            {currentLook.pieces.map((piece) => {
              const isLiked = Boolean(likedMap[piece.id]);
              const isAdded = Boolean(addedLookup[piece.id]);

              return (
                <li key={piece.id} className="vishrea-piece-item" onClick={() => onSelectPiece?.(piece)}>
                  {/* Thumbnail */}
                  <div
                    className="vishrea-piece-thumb"
                    style={{
                      backgroundImage: piece.image_url ? `url(${piece.image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundColor: piece.image_url ? undefined : 'rgba(123, 20, 38, 0.08)',
                    }}
                  />

                  {/* Piece info */}
                  <div className="vishrea-piece-info">
                    <small className="vishrea-piece-eyebrow">
                      VISHRÉA · {piece.role?.toUpperCase() || piece.category?.toUpperCase() || 'STUDIO'}
                    </small>
                    <div className="vishrea-piece-title">{piece.name}</div>
                    {piece.price_inr !== undefined && piece.price_inr !== null && (
                      <div className="vishrea-piece-price">{formatINR(piece.price_inr)}</div>
                    )}
                  </div>

                  {/* Actions: Heart + Plus */}
                  <div className="vishrea-piece-actions">
                    <button
                      type="button"
                      className={`vishrea-ic-btn ${isLiked ? 'active-heart' : ''}`}
                      style={{ width: '36px', height: '36px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleHeart(piece.id, piece);
                      }}
                      aria-label={isLiked ? `Remove ${piece.name} from wishlist` : `Wishlist ${piece.name}`}
                    >
                      <HeartIcon filled={isLiked} />
                    </button>

                    <button
                      type="button"
                      className="vishrea-ic-btn"
                      style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: isAdded ? '#7B1426' : '#ffffff',
                        color: isAdded ? '#ffffff' : 'var(--vishrea-ink)',
                        borderColor: isAdded ? '#7B1426' : undefined,
                      }}
                      onClick={(e) => handleAddPiece(piece, e)}
                      aria-label={`Add ${piece.name} to Wardrobe Bag`}
                    >
                      {isAdded ? <CheckIcon /> : <PlusIcon />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Bottom Actions: "Add full look to Wardrobe Bag" pill + Heart */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--vishrea-line)' }}>
            <button
              type="button"
              className="vishrea-pill-btn"
              style={{ flex: 1, minHeight: '48px' }}
              onClick={handleAddFullLook}
            >
              <BagIcon />
              <span>{fullLookAdded ? 'LOOK ADDED TO BAG' : 'ADD FULL LOOK TO WARDROBE BAG'}</span>
            </button>

            <button
              type="button"
              className={`vishrea-ic-btn ${likedMap[currentLook.id] ? 'active-heart' : ''}`}
              style={{ width: '48px', height: '48px' }}
              onClick={() => toggleHeart(currentLook.id)}
              aria-label="Wishlist entire look"
            >
              <HeartIcon filled={Boolean(likedMap[currentLook.id])} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
