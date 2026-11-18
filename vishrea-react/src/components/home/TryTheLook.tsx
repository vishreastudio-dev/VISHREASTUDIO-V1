import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArcEngine } from './ArcEngine';
import type { TryTheLookProps, LookItem, LookPiece, CatalogueProduct } from './types';
import { readLikes, toggleLike, likeAllInLook } from '../../lib/likes';
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
  '/assets/occasion-look.jpg',
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

// Fallback real products from Vishrea Studio catalogue if remote query is empty or loading
const FALLBACK_NEW_ARRIVALS: CatalogueProduct[] = [
  {
    id: 'prod-dress-1',
    name: 'After Hours Dress',
    slug: 'after-hours-dress',
    category: 'Party Dresses',
    price_inr: 3990,
    image_url: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=600&q=80',
    color: '#7B1426',
    available: true,
  },
  {
    id: 'prod-top-1',
    name: 'Sculpted Everyday Top',
    slug: 'sculpted-everyday-top',
    category: 'Tops',
    price_inr: 2190,
    image_url: '/assets/tops.jpg',
    color: '#1a1719',
    available: true,
  },
  {
    id: 'prod-coord-1',
    name: 'Soft Structure Coord',
    slug: 'soft-structure-coord',
    category: 'Coord Sets',
    price_inr: 4290,
    image_url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80',
    color: '#b89560',
    available: true,
  },
  {
    id: 'prod-dress-2',
    name: 'The Wine Slip Dress',
    slug: 'the-wine-slip-dress',
    category: 'Dresses',
    price_inr: 3490,
    image_url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=600&q=80',
    color: '#7B1426',
    available: true,
  },
  {
    id: 'prod-knit-1',
    name: 'Fluffy Bunny Appliqué Knit',
    slug: 'fluffy-bunny-applique-knit',
    category: 'Sweaters',
    price_inr: 2990,
    image_url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80',
    color: '#f6f1e7',
    available: true,
  },
  {
    id: 'prod-top-2',
    name: 'Everyday Crop Top',
    slug: 'everyday-crop-top',
    category: 'Crop Tops',
    price_inr: 1590,
    image_url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=600&q=80',
    color: '#ffffff',
    available: true,
  },
  {
    id: 'prod-pant-1',
    name: 'Tailored Wide-Leg Pant',
    slug: 'tailored-wide-leg-pant',
    category: 'Pants',
    price_inr: 2790,
    image_url: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=600&q=80',
    color: '#2a0a12',
    available: true,
  },
  {
    id: 'prod-cardigan-1',
    name: 'Relaxed Knit Cardigan',
    slug: 'relaxed-knit-cardigan',
    category: 'Cardigans',
    price_inr: 2490,
    image_url: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=600&q=80',
    color: '#b45309',
    available: true,
  },
  {
    id: 'prod-shrug-1',
    name: 'Longline Shrug',
    slug: 'longline-shrug',
    category: 'Long Coats & Shrugs',
    price_inr: 3290,
    image_url: 'https://images.unsplash.com/photo-1550614000-4895a10e1bfd?auto=format&fit=crop&w=600&q=80',
    color: '#166534',
    available: true,
  },
  {
    id: 'prod-dress-3',
    name: 'Fluffy Bunny',
    slug: 'fluffy-bunny',
    category: 'Dresses',
    price_inr: 1999,
    image_url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=600&q=80',
    color: '#fdf5f6',
    available: true,
  },
];

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
  user,
  onAddToBag,
  onAddFullLook,
  onToggleHeart,
  onSelectPiece,
}) => {
  const navigate = useNavigate();
  const [activeIdx, setActiveIdx] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>(() => {
    const map = readLikes();
    const res: Record<string, boolean> = {};
    Object.keys(map).forEach((k) => {
      res[k] = true;
    });
    return res;
  });
  const [addedLookup, setAddedLookup] = useState<Record<string, boolean>>({});
  const [fullLookAdded, setFullLookAdded] = useState(false);
  const [toastMsg, setToastMsg] = useState<string>('');
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync likes with localStorage changes across components/tabs
  useEffect(() => {
    const updateFromStorage = () => {
      const map = readLikes();
      const res: Record<string, boolean> = {};
      Object.keys(map).forEach((k) => {
        res[k] = true;
      });
      setLikedMap(res);
    };

    window.addEventListener('vishrea_likes_changed', updateFromStorage);
    window.addEventListener('storage', updateFromStorage);
    return () => {
      window.removeEventListener('vishrea_likes_changed', updateFromStorage);
      window.removeEventListener('storage', updateFromStorage);
    };
  }, []);

  const showFeedback = (msg: string) => {
    setToastMsg(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMsg(''), 2400);
  };

  // Generate 8 curated looks bound to REAL data layer products in New Arrivals
  const looks: LookItem[] = useMemo(() => {
    if (customLooks && customLooks.length >= 8) {
      return customLooks.slice(0, 8);
    }

    const availableProducts = products && products.length > 0 ? products : FALLBACK_NEW_ARRIVALS;
    const piecesPerLook = Math.min(6, availableProducts.length);

    return LOOK_NAMES.map((name, lookIdx) => {
      // Pick distinct real products from New Arrivals for each curated look
      const pieces: LookPiece[] = Array.from({ length: piecesPerLook }, (_, pieceOffset) => {
        const prodIndex = (lookIdx * 2 + pieceOffset) % availableProducts.length;
        const prod = availableProducts[prodIndex];

        return {
          id: String(prod.id),
          name: prod.name,
          category: prod.category || 'Vishrea Studio',
          price_inr: prod.price_inr ?? null,
          image_url: prod.image_url || (Array.isArray(prod.images) ? prod.images[0] : null) || null,
          color: prod.color || '#7B1426',
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

  const toggleHeart = async (id: string, piece?: LookPiece) => {
    const target = piece || currentLook.pieces.find((p) => p.id === id);
    if (!target) return;

    const willLike = !likedMap[id];
    setLikedMap((prev) => ({ ...prev, [id]: willLike }));

    try {
      await toggleLike(target, user);
      showFeedback(willLike ? `Saved "${target.name}" to Likes` : `Removed "${target.name}" from Likes`);
      onToggleHeart?.(id, target);
    } catch {
      // Revert if error
      setLikedMap((prev) => ({ ...prev, [id]: !willLike }));
    }
  };

  const handleToggleLookHeart = async () => {
    const lookId = currentLook.id;
    const isLookLiked = Boolean(likedMap[lookId]);

    if (isLookLiked) {
      const next = { ...likedMap };
      delete next[lookId];
      for (const piece of currentLook.pieces) {
        delete next[piece.id];
        await toggleLike(piece, user);
      }
      setLikedMap(next);
      showFeedback(`Removed "${currentLook.name}" look from Likes`);
    } else {
      const next = { ...likedMap, [lookId]: true };
      for (const piece of currentLook.pieces) {
        next[piece.id] = true;
      }
      setLikedMap(next);
      await likeAllInLook(currentLook.pieces, user);
      showFeedback(`Saved all pieces in "${currentLook.name}" to Likes & Wardrobe`);
    }
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

  const handleShopLook = (e: React.MouseEvent) => {
    e.stopPropagation();
    const heroPiece = currentLook.pieces[0];
    if (heroPiece?.product?.slug) {
      navigate(`/product/${encodeURIComponent(heroPiece.product.slug)}`);
    } else {
      navigate('/catalogue?sort=newest');
    }
  };

  return (
    <section className="vishrea-section" id="shop" aria-labelledby="try-the-look-heading">
      {/* Toast Notification for Likes & Bag */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#1a1719',
            color: '#ffffff',
            padding: '12px 22px',
            borderRadius: '9999px',
            fontSize: '0.82rem',
            fontWeight: 500,
            letterSpacing: '0.04em',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            border: '1px solid rgba(201, 152, 74, 0.4)',
          }}
        >
          <HeartIcon filled={true} />
          <span>{toastMsg}</span>
        </div>
      )}

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

        {/* Right Column: "In this look" Panel with REAL PRODUCTS in New Arrivals */}
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
              const productSlug = piece.product?.slug || '';
              const productHref = productSlug ? `/product/${encodeURIComponent(productSlug)}` : '/catalogue';

              return (
                <li key={piece.id} className="vishrea-piece-item" onClick={() => onSelectPiece?.(piece)}>
                  {/* Real Product Thumbnail linking to PDP */}
                  <Link
                    to={productHref}
                    className="vishrea-piece-thumb"
                    style={{
                      backgroundImage: piece.image_url ? `url(${piece.image_url})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundColor: piece.image_url ? undefined : 'rgba(123, 20, 38, 0.08)',
                      display: 'block',
                      textDecoration: 'none',
                    }}
                    aria-label={`View ${piece.name}`}
                  />

                  {/* Real Piece info linking to PDP */}
                  <div className="vishrea-piece-info">
                    <small className="vishrea-piece-eyebrow">
                      VISHRÉA · {piece.category?.toUpperCase() || 'STUDIO'}
                    </small>
                    <Link
                      to={productHref}
                      className="vishrea-piece-title"
                      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
                      title={piece.name}
                    >
                      {piece.name}
                    </Link>
                    {piece.price_inr !== undefined && piece.price_inr !== null && (
                      <div className="vishrea-piece-price">{formatINR(piece.price_inr)}</div>
                    )}
                  </div>

                  {/* Actions: Heart (Stores in Likes) + Plus (Adds to Bag) */}
                  <div className="vishrea-piece-actions">
                    <button
                      type="button"
                      className={`vishrea-ic-btn ${isLiked ? 'active-heart' : ''}`}
                      style={{
                        width: '36px',
                        height: '36px',
                        color: isLiked ? '#7B1426' : undefined,
                        borderColor: isLiked ? '#7B1426' : undefined,
                        backgroundColor: isLiked ? '#fdf5f6' : undefined,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleHeart(piece.id, piece);
                      }}
                      aria-label={isLiked ? `Remove ${piece.name} from Likes` : `Save ${piece.name} to Likes`}
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

          {/* Bottom Actions: "Shop this look" pill + Wishlist Look Heart */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--vishrea-line)' }}>
            <button
              type="button"
              className="vishrea-pill-btn"
              style={{ flex: 1, minHeight: '48px' }}
              onClick={handleShopLook}
            >
              <BagIcon />
              <span>SHOP THIS LOOK</span>
            </button>

            <button
              type="button"
              className={`vishrea-ic-btn ${likedMap[currentLook.id] ? 'active-heart' : ''}`}
              style={{
                width: '48px',
                height: '48px',
                color: likedMap[currentLook.id] ? '#7B1426' : undefined,
                borderColor: likedMap[currentLook.id] ? '#7B1426' : undefined,
                backgroundColor: likedMap[currentLook.id] ? '#fdf5f6' : undefined,
              }}
              onClick={handleToggleLookHeart}
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
