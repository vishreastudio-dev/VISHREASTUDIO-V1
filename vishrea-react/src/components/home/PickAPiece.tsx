import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { ArcEngine } from './ArcEngine';
import type { PickAPieceProps, CategoryItem } from './types';
import { readLikes, toggleLike } from '../../lib/likes';
import './home-sections.css';

// Bold solid colors specified in the prompt: maroon, purple, mustard, crimson, gold, green
const BOLD_CARD_COLORS = [
  { bg: '#7B1426', label: 'Maroon' },
  { bg: '#581c87', label: 'Purple' },
  { bg: '#b45309', label: 'Mustard' },
  { bg: '#991B1B', label: 'Crimson' },
  { bg: '#C9984A', label: 'Gold' },
  { bg: '#166534', label: 'Green' },
  { bg: '#2a0a12', label: 'Deep Wine' },
];

const DEFAULT_CATEGORIES: CategoryItem[] = [
  {
    slug: 'coord-sets',
    name: 'Co-ord Sets',
    tagline: 'STARTING ₹1,850 • MATCH & STYLE',
    cls: 'cat-coords',
    image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82',
  },
  {
    slug: 'dresses',
    name: 'Dresses',
    tagline: 'STARTING ₹1,450 • TIMELESS SILHOUETTES',
    cls: 'cat-dresses',
    image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=82',
  },
  {
    slug: 'tops',
    name: 'Tops & Blouses',
    tagline: 'STARTING ₹1,250 • CHIC & EVERYDAY',
    cls: 'cat-tops',
    image: '/assets/tops.jpg',
  },
  {
    slug: 'pants',
    name: 'Trousers & Bottoms',
    tagline: 'STARTING ₹1,350 • TAILORED COMFORT',
    cls: 'cat-pants',
    image: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=88',
  },
  {
    slug: 'party-dresses',
    name: 'Occasion & Party Wear',
    tagline: 'STARTING ₹2,100 • ELEGANT DRAPES',
    cls: 'cat-party',
    image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=82',
  },
];

// SVG Icons (no emojis)
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

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? '#ffffff' : 'none'} stroke={filled ? '#ffffff' : '#ffffff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

interface CardItemProps {
  item: {
    slug: string;
    name: string;
    tagline: string;
    image_url: string;
    bgColor: string;
    category: CategoryItem;
  };
  isActive: boolean;
  isLiked: boolean;
  isSpringing: boolean;
  onToggleHeart: () => void;
  onNavigate: () => void;
}

const TiltableCategoryCard: React.FC<CardItemProps> = ({
  item,
  isActive,
  isLiked,
  isSpringing,
  onToggleHeart,
  onNavigate,
}) => {
  const prefersReduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPressed, setIsPressed] = useState(false);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReduced || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width - 0.5;
    const yRel = (e.clientY - rect.top) / rect.height - 0.5;

    setTilt({
      x: Math.max(-8, Math.min(8, -yRel * 16)),
      y: Math.max(-8, Math.min(8, xRel * 16)),
    });
  };

  const handlePointerLeave = () => {
    setTilt({ x: 0, y: 0 });
    setIsPressed(false);
  };

  return (
    <motion.div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      animate={{
        rotateX: prefersReduced ? 0 : tilt.x,
        rotateY: prefersReduced ? 0 : tilt.y,
        scale: isPressed ? 0.97 : 1,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
      }}
      style={{
        width: '260px',
        height: '420px',
        borderRadius: '22px',
        padding: '18px',
        backgroundColor: item.bgColor,
        boxShadow: isActive
          ? '0 24px 48px -12px rgba(0, 0, 0, 0.4), 0 10px 20px -6px rgba(0, 0, 0, 0.25)'
          : '0 14px 28px -8px rgba(0, 0, 0, 0.25)',
        color: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        transformOrigin: '50% 120%',
        cursor: 'pointer',
      }}
      onClick={onNavigate}
    >
      {/* Huge condensed uppercase category title behind the model */}
      <h3
        style={{
          position: 'absolute',
          inset: '16px 10px auto',
          textAlign: 'center',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 800,
          fontSize: 'clamp(2rem, 3.8vw, 2.5rem)',
          lineHeight: 0.88,
          letterSpacing: '-0.04em',
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.95)',
          zIndex: 1,
          wordBreak: 'break-word',
          pointerEvents: 'none',
          margin: 0,
        }}
      >
        {item.name}
      </h3>

      {/* Model/Category image in front of text with soft drop shadow */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '54px',
          width: '74%',
          height: '62%',
          transform: 'translateX(-50%)',
          borderRadius: '14px',
          boxShadow: '0 18px 26px -8px rgba(0, 0, 0, 0.55)',
          backgroundImage: `url(${item.image_url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          zIndex: 2,
        }}
      />

      {/* Heart top-right */}
      <button
        type="button"
        style={{
          position: 'absolute',
          right: '14px',
          top: '14px',
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: isLiked ? 'rgba(123, 20, 38, 0.8)' : 'rgba(0, 0, 0, 0.28)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255, 255, 255, 0.4)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 4,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHeart();
        }}
        aria-label={isLiked ? `Remove ${item.name} from wishlist` : `Wishlist ${item.name}`}
      >
        <HeartIcon filled={isLiked} />
      </button>

      {/* Tagline bottom-left */}
      <div
        style={{
          position: 'absolute',
          left: '16px',
          bottom: '16px',
          right: '65px',
          zIndex: 3,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            display: 'block',
            fontSize: '0.66rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(255, 255, 255, 0.9)',
            fontWeight: 600,
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
          }}
        >
          {item.tagline}
        </span>
      </div>

      {/* Round black button with arrow bottom-right that drops the piece / navigates with a spring */}
      <motion.button
        type="button"
        style={{
          position: 'absolute',
          right: '14px',
          bottom: '14px',
          width: '42px',
          height: '42px',
          borderRadius: '50%',
          backgroundColor: '#000000',
          color: '#ffffff',
          border: '2px solid #ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 6px 16px rgba(0, 0, 0, 0.4)',
          zIndex: 4,
        }}
        animate={
          isSpringing
            ? {
                scale: [1, 0.75, 1.25, 0.95, 1],
                rotate: [0, -15, 15, 0],
              }
            : { scale: 1, rotate: 0 }
        }
        transition={{
          type: 'spring',
          stiffness: 450,
          damping: 14,
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        aria-label={`Explore ${item.name} category`}
      >
        <ArrowRightIcon />
      </motion.button>
    </motion.div>
  );
};

export const PickAPiece: React.FC<PickAPieceProps> = ({
  categories = DEFAULT_CATEGORIES,
  onSelectCategory,
}) => {
  const navigate = useNavigate();
  const [activeIdx, setActiveIdx] = useState(1);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>(() => {
    const map = readLikes();
    const res: Record<string, boolean> = {};
    Object.keys(map).forEach((k) => {
      res[k] = true;
    });
    return res;
  });
  const [springingMap, setSpringingMap] = useState<Record<string, boolean>>({});

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

  const items = useMemo(() => {
    return categories.map((cat, idx) => {
      const colorObj = BOLD_CARD_COLORS[idx % BOLD_CARD_COLORS.length];
      return {
        slug: cat.slug,
        name: cat.name,
        tagline: cat.tagline,
        image_url:
          cat.image ||
          (cat.cls === 'cat-tops'
            ? '/assets/tops.jpg'
            : cat.cls === 'cat-dresses'
            ? 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=82'
            : cat.cls === 'cat-coords'
            ? 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82'
            : cat.cls === 'cat-pants'
            ? 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=88'
            : 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=82'),
        bgColor: colorObj.bg,
        category: cat,
      };
    });
  }, [categories]);

  const handleNavigate = (cat: CategoryItem) => {
    setSpringingMap((prev) => ({ ...prev, [cat.slug]: true }));
    setTimeout(() => {
      if (onSelectCategory) {
        onSelectCategory(cat);
      } else {
        navigate(`/catalogue/${cat.slug}`);
      }
    }, 250);
  };

  return (
    <section className="vishrea-section" id="collections" aria-labelledby="collections-title">
      {/* Section Head with Render Content */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ display: 'inline-block', width: '20px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
            <p className="vishrea-sub" style={{ margin: 0 }}>EXPLORE CATEGORIES</p>
          </div>
          <h2 id="collections-title" className="vishrea-headline">
            Start with what<br />
            you <span className="vishrea-gradient-text">reach for.</span>
          </h2>
          <p className="vishrea-sub" style={{ marginTop: '10px', maxWidth: '44ch', textTransform: 'none', fontSize: '0.95rem' }}>
            Discover our curated edit of styles for every mood and moment.
          </p>
        </div>

        <Link
          className="vishrea-pill-btn"
          to="/catalogue"
          style={{ textDecoration: 'none' }}
        >
          <span>VIEW ALL CATEGORIES</span>
          <ArrowRightIcon />
        </Link>
      </div>

      {/* Fanned Arc Stage */}
      <ArcEngine
        items={items}
        activeIndex={activeIdx}
        onChange={setActiveIdx}
        gap={250}
        lift={16}
        rot={6}
        fade={0.1}
        blur={false}
        centreScale={1.05}
        stageHeight={540}
        ariaLabel="Explore categories carousel"
        onItemClick={(item) => handleNavigate(item.category)}
        renderItem={(item, k, { isActive }) => (
          <TiltableCategoryCard
            item={item}
            isActive={isActive}
            isLiked={Boolean(likedMap[item.slug])}
            isSpringing={Boolean(springingMap[item.slug])}
            onToggleHeart={() => {
              const willLike = !likedMap[item.slug];
              setLikedMap((prev) => ({ ...prev, [item.slug]: willLike }));
              toggleLike({ id: item.slug, name: item.name, category: 'Category', image_url: item.image_url, slug: `catalogue/${item.slug}` });
            }}
            onNavigate={() => handleNavigate(item.category)}
          />
        )}
      />

      {/* Navigation Controls Centered Below */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '16px',
          marginTop: '24px',
        }}
      >
        <button
          type="button"
          className="vishrea-ic-btn"
          onClick={() => setActiveIdx((prev) => (prev - 1 + items.length) % items.length)}
          aria-label="Previous category"
        >
          <ChevronLeftIcon />
        </button>

        <span
          style={{
            fontSize: '0.85rem',
            color: 'var(--vishrea-soft)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {activeIdx + 1} of {items.length} · {items[activeIdx]?.name}
        </span>

        <button
          type="button"
          className="vishrea-ic-btn"
          onClick={() => setActiveIdx((prev) => (prev + 1) % items.length)}
          aria-label="Next category"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Category Footer Banner matching Render */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          marginTop: '48px',
          paddingTop: '20px',
          borderTop: '1px solid var(--vishrea-line)',
          fontSize: '0.72rem',
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: 'var(--vishrea-soft)',
        }}
        aria-hidden="true"
      >
        <span style={{ color: '#C9984A' }}>✦</span>
        <span>FASHION FOR EVERY YOU</span>
        <span style={{ color: '#C9984A' }}>✦</span>
      </div>
    </section>
  );
};
