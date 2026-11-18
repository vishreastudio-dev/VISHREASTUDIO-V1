import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArcEngine } from './ArcEngine';
import type { StyleInMotionProps, ReelItem } from './types';
import './home-sections.css';

const DEFAULT_REELS: ReelItem[] = [
  {
    id: 'reel-1',
    reelNumber: 1,
    title: 'Studio Atelier',
    location: 'Bengaluru',
    categoryTag: 'MULBERRY SILK · DRAPE',
    duration: '0:34',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=700&q=85',
  },
  {
    id: 'reel-2',
    reelNumber: 2,
    title: 'Morning Sun',
    location: 'Indiranagar',
    categoryTag: 'LINEN BLEND · CO-ORDS',
    duration: '0:28',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=85',
  },
  {
    id: 'reel-3',
    reelNumber: 3,
    title: 'Rooftop Silhouette',
    location: 'Evening Dusk',
    categoryTag: 'FLUID CREPE · SLIP',
    duration: '0:42',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=700&q=85',
  },
  {
    id: 'reel-4',
    reelNumber: 4,
    title: 'Weekend Market',
    location: 'Lavelle Road',
    categoryTag: 'TAILORED TWILL · BOTTOMS',
    duration: '0:30',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=700&q=85',
  },
  {
    id: 'reel-5',
    reelNumber: 5,
    title: 'Art Gallery',
    location: 'Afternoon Light',
    categoryTag: 'HEAVY SATIN · OCCASION',
    duration: '0:38',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=700&q=85',
  },
];

// SVG Icons (Strictly no emojis)
const PlayIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="6" y1="4" x2="6" y2="20" />
    <line x1="18" y1="4" x2="18" y2="20" />
  </svg>
);

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

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const StyleInMotion: React.FC<StyleInMotionProps> = ({
  reels: customReels,
  videos = [],
}) => {
  // Bind 5 reel items to real data layer if available, or fallback gracefully
  const reels: ReelItem[] = useMemo(() => {
    if (customReels && customReels.length >= 5) {
      return customReels.slice(0, 5);
    }

    if (videos.length >= 5) {
      return videos.slice(0, 5).map((v, i) => ({
        id: v.id || `video-${i}`,
        reelNumber: i + 1,
        title: v.title || DEFAULT_REELS[i].title,
        location: v.customer_name || DEFAULT_REELS[i].location,
        categoryTag: DEFAULT_REELS[i].categoryTag,
        duration: v.duration_seconds ? `0:${String(v.duration_seconds).padStart(2, '0')}` : DEFAULT_REELS[i].duration,
        videoUrl: v.video_url || DEFAULT_REELS[i].videoUrl,
        thumbnailUrl: DEFAULT_REELS[i].thumbnailUrl,
      }));
    }

    return DEFAULT_REELS;
  }, [customReels, videos]);

  const [activeIdx, setActiveIdx] = useState(2);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [fullscreenReel, setFullscreenReel] = useState<ReelItem | null>(null);

  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);

  const total = reels.length;

  const goNext = useCallback(() => {
    setActiveIdx((prev) => (prev + 1) % total);
    setProgress(0);
  }, [total]);

  const goPrev = useCallback(() => {
    setActiveIdx((prev) => (prev - 1 + total) % total);
    setProgress(0);
  }, [total]);

  // Autoplay every 4s with gold progress bar
  useEffect(() => {
    if (!isPlaying || fullscreenReel !== null) {
      return undefined;
    }

    const intervalMs = 50;
    const totalDurationMs = 4000;
    const step = (intervalMs / totalDurationMs) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          goNext();
          return 0;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, fullscreenReel, goNext]);

  // Close fullscreen on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreenReel(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openFullscreen = (reel: ReelItem) => {
    setFullscreenReel(reel);
    setIsPlaying(false);
  };

  const closeFullscreen = () => {
    setFullscreenReel(null);
    setIsPlaying(true);
  };

  return (
    <section className="vishrea-section" id="socialProof" aria-labelledby="social-title">
      {/* Head with Title and Controls top-right matching Render */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '36px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ display: 'inline-block', width: '20px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
            <p className="vishrea-sub" style={{ margin: 0 }}>WORN BY OUR CUSTOMERS</p>
          </div>
          <h2 id="social-title" className="vishrea-headline">
            Real women,<br />
            real <span className="vishrea-gradient-text">wardrobes.</span>
          </h2>
        </div>

        <div>
          <p className="vishrea-sub" style={{ textAlign: 'right', marginBottom: '14px', maxWidth: '42ch', textTransform: 'none', fontSize: '0.92rem' }}>
            Customer stories and studio reels filmed in real places. Tap the centre reel to play.
          </p>

          {/* Controls: Prev, Pause/Play (Autoplay 4s), Next */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="vishrea-ic-btn"
              onClick={goPrev}
              aria-label="Previous reel"
            >
              <ChevronLeftIcon />
            </button>

            <button
              type="button"
              className="vishrea-ic-btn"
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? 'Pause autoplay' : 'Start autoplay'}
              style={{
                backgroundColor: isPlaying ? '#7B1426' : '#ffffff',
                color: isPlaying ? '#ffffff' : 'var(--vishrea-ink)',
                borderColor: isPlaying ? '#C9984A' : undefined,
              }}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon size={16} />}
            </button>

            <button
              type="button"
              className="vishrea-ic-btn"
              onClick={goNext}
              aria-label="Next reel"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* 3D Arc of Five Vertical Reel Cards */}
      <ArcEngine
        items={reels}
        activeIndex={activeIdx}
        onChange={(idx) => {
          setActiveIdx(idx);
          setProgress(0);
        }}
        gap={200}
        lift={10}
        rot={7}
        fade={0.15}
        blur={false}
        centreScale={1.08}
        stageHeight={500}
        ariaLabel="Reels 3D carousel"
        onItemClick={(item) => openFullscreen(item)}
        renderItem={(reel, k, { isActive }) => (
          <div
            className="vishrea-reel-card"
            style={{
              backgroundImage: `url(${reel.thumbnailUrl})`,
              border: isActive ? '2px solid rgba(201, 152, 74, 0.7)' : '1px solid rgba(255, 255, 255, 0.15)',
            }}
          >
            {/* Center card shows play button */}
            {isActive && (
              <button
                type="button"
                className="vishrea-reel-play-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  openFullscreen(reel);
                }}
                aria-label={`Play ${reel.title} in fullscreen`}
              >
                <PlayIcon size={24} />
              </button>
            )}

            {/* Reel Content Details */}
            <div className="vishrea-reel-content">
              <div className="vishrea-reel-eyebrow">
                <span>REEL 0{reel.reelNumber}</span>
                <span>{reel.duration}</span>
              </div>

              <div
                style={{
                  fontSize: '0.62rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(255, 255, 255, 0.85)',
                  marginBottom: '4px',
                }}
              >
                {reel.categoryTag}
              </div>

              <h3 className="vishrea-reel-title">{reel.title}</h3>
              <div className="vishrea-reel-loc">{reel.location}</div>

              {/* Gold Progress Bar on Centre Card */}
              {isActive && (
                <div className="vishrea-reel-progress">
                  <div
                    className="vishrea-reel-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      />

      {/* Fullscreen Video Player Modal */}
      <AnimatePresence>
        {fullscreenReel && (
          <motion.div
            className="vishrea-fullscreen-player"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeFullscreen}
          >
            <motion.div
              className="vishrea-fullscreen-wrapper"
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                type="button"
                className="vishrea-fullscreen-close"
                onClick={closeFullscreen}
                aria-label="Close fullscreen reel"
              >
                <CloseIcon />
              </button>

              {/* Real Video Element with Sound */}
              <video
                ref={fullscreenVideoRef}
                src={fullscreenReel.videoUrl}
                autoPlay
                playsInline
                loop
                muted={false}
                controls
                className="vishrea-fullscreen-video"
              />

              {/* Meta Overlay */}
              <div className="vishrea-fullscreen-meta">
                <div style={{ fontSize: '0.72rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#C9984A', fontWeight: 600, marginBottom: '4px' }}>
                  REEL 0{fullscreenReel.reelNumber} · {fullscreenReel.categoryTag}
                </div>
                <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.6rem', fontWeight: 800, margin: '0 0 4px 0' }}>
                  {fullscreenReel.title}
                </h3>
                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                  {fullscreenReel.location}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
