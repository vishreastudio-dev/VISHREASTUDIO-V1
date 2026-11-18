import React, { useState, useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { FeelTheDrapeProps } from './types';
import './home-sections.css';

// Curated lifestyle photos for opposite-scrolling columns
const DEFAULT_LIFESTYLE_PHOTOS = [
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=85',
  'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=600&q=85',
  'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=600&q=85',
  'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=600&q=85',
  'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=600&q=85',
  'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=600&q=85',
];

// Drone video tour of Vishrea Studio Bengaluru
const FALLBACK_VIDEO_URL = '/assets/vishrea-drone.mp4';

// SVG Icons (Strictly no emojis)
const VolumeXIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const Volume2Icon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

export const FeelTheDrape: React.FC<FeelTheDrapeProps> = ({
  imageUrl = '/assets/studio-storefront.jpg',
  videoUrl = '/assets/vishrea-drone.mp4',
  lifestylePhotos = DEFAULT_LIFESTYLE_PHOTOS,
  onShopCollection,
}) => {
  const prefersReduced = useReducedMotion();
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Guarantee video auto-playback on mount
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  // Magnetic CTA state
  const [magneticOffset, setMagneticOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const toggleSound = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMagneticMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (prefersReduced || e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    // Maximum 15px displacement
    const clamp = (v: number) => Math.max(-15, Math.min(15, v * 0.3));
    setMagneticOffset({ x: clamp(x), y: clamp(y) });
  };

  const handleMagneticLeave = () => {
    setMagneticOffset({ x: 0, y: 0 });
  };

  // Duplicated photo list for infinite CSS scroll
  const loopedPhotos = [...lifestylePhotos, ...lifestylePhotos];

  return (
    <section className="vishrea-section" id="story" aria-labelledby="story-heading">
      {/* Centered Headline with Render Content */}
      <div style={{ textAlign: 'center', marginBottom: '36px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
          <p className="vishrea-sub" style={{ margin: 0 }}>ABOUT THE STUDIO · BENGALURU</p>
        </div>
        <h2 id="story-heading" className="vishrea-headline" style={{ margin: '0 auto' }}>
          Fewer Pieces.<br />
          Chosen <span className="vishrea-gradient-text">Properly.</span>
        </h2>
        <p className="vishrea-sub" style={{ marginTop: '10px', maxWidth: '52ch', margin: '10px auto 0', textTransform: 'none', fontSize: '0.95rem' }}>
          Feel the drape, touch the textures, and discover the craftsmanship behind each curated silhouette.
        </p>
      </div>

      <div className="vishrea-film-grid">
        {/* Left Column: Vertical Photos Scrolling Upward */}
        <div className="vishrea-photo-col" aria-hidden="true">
          <div className="vishrea-photo-stream">
            {loopedPhotos.map((img, i) => (
              <span
                key={`left-${i}`}
                className="vishrea-photo-card"
                style={{ backgroundImage: `url(${img})` }}
              />
            ))}
          </div>
        </div>

        {/* Center: 16:9 Brand Film with Gold Frame & Corner Brackets */}
        <div>
          <div className="vishrea-gold-frame">
            {/* Corner Brackets */}
            <span className="vishrea-gold-bracket top-left" aria-hidden="true" />
            <span className="vishrea-gold-bracket top-right" aria-hidden="true" />
            <span className="vishrea-gold-bracket bottom-left" aria-hidden="true" />
            <span className="vishrea-gold-bracket bottom-right" aria-hidden="true" />

            <div className="vishrea-film-box">
              <video
                ref={videoRef}
                src={videoUrl || FALLBACK_VIDEO_URL}
                autoPlay
                loop
                muted={isMuted}
                playsInline
                preload="auto"
                poster={imageUrl || '/assets/studio-storefront.jpg'}
                className="vishrea-film-video"
                aria-label="Vishrea Studio boutique drone video tour"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  display: 'block',
                }}
              />

              {/* Sound on/off pill */}
              <button
                type="button"
                className="vishrea-sound-pill"
                onClick={toggleSound}
                aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
              >
                {isMuted ? <VolumeXIcon /> : <Volume2Icon />}
                <span>{isMuted ? 'SOUND OFF' : 'SOUND ON'}</span>
              </button>
            </div>
          </div>

          {/* Studio Narrative & Visiting Details from Render */}
          <div style={{ maxWidth: '640px', margin: '34px auto 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--vishrea-soft)', fontSize: '0.96rem', lineHeight: '1.8', margin: '0 0 14px 0' }}>
              Vishrea is a boutique womenswear studio in Bengaluru. Most pieces are one-of-one, so our curated edit changes from week to week. We focus on modern silhouettes, rich handloom textures, and thoughtful tailoring.
            </p>
            <p style={{ color: 'var(--vishrea-soft)', fontSize: '0.96rem', lineHeight: '1.8', margin: '0 0 24px 0' }}>
              Visit our Bengaluru studio for a complimentary 1-on-1 personal styling consultation, or shop online with free studio pickup and flat ₹99 insured courier delivery across India.
            </p>

            {/* Links */}
            <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '28px', fontSize: '0.78rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              <Link to="/contact" style={{ color: 'var(--vishrea-ink)', textDecoration: 'underline', fontWeight: 600 }}>
                Visiting, delivery and exchanges →
              </Link>
              <a href="https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--vishrea-ink)', textDecoration: 'underline', fontWeight: 600 }}>
                Studio location on Google Maps ↗
              </a>
            </div>
          </div>

          {/* Under Film: SHOP THE COLLECTION Pill with Magnetic Hover (max 15px) */}
          <div style={{ textAlign: 'center', marginTop: '10px' }}>
            <motion.a
              href="/catalogue"
              className="vishrea-pill-btn"
              onPointerMove={handleMagneticMove}
              onPointerLeave={handleMagneticLeave}
              onClick={(e) => {
                if (onShopCollection) {
                  e.preventDefault();
                  onShopCollection();
                }
              }}
              animate={{
                x: prefersReduced ? 0 : magneticOffset.x,
                y: prefersReduced ? 0 : magneticOffset.y,
              }}
              transition={{
                type: 'spring',
                stiffness: 350,
                damping: 20,
              }}
              style={{
                display: 'inline-flex',
                padding: '16px 36px',
                fontSize: '0.82rem',
                letterSpacing: '0.18em',
              }}
            >
              SHOP THE COLLECTION
            </motion.a>
          </div>
        </div>

        {/* Right Column: Vertical Photos Scrolling Downward (Reversed) */}
        <div className="vishrea-photo-col is-reversed" aria-hidden="true">
          <div className="vishrea-photo-stream">
            {loopedPhotos.map((img, i) => (
              <span
                key={`right-${i}`}
                className="vishrea-photo-card"
                style={{ backgroundImage: `url(${img})` }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
