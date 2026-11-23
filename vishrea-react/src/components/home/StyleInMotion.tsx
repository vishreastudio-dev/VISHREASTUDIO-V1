import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArcEngine } from './ArcEngine';
import type { StyleInMotionProps, ReelItem } from './types';
import dezv4bCover from '../../assets/ig-reel-dezv4b.jpg';
import dd653rCover from '../../assets/ig-reel-dd653r.jpg';
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

const InstagramIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const instagramId = (url?: string) => {
  const m = String(url || '').match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};

const getInstagramThumbnail = (postUrl?: string, customImage?: string) => {
  if (customImage && customImage.trim()) {
    return customImage.trim();
  }
  const url = String(postUrl || '');
  if (/DezV4[B8]Ly2AB/i.test(url)) {
    return dezv4bCover;
  }
  if (/Dd653r[lI]TO-D/i.test(url)) {
    return dd653rCover;
  }
  const idMatch = instagramId(url);
  if (idMatch) {
    return `https://www.instagram.com/p/${idMatch}/media/?size=l`;
  }
  return null;
};

export const StyleInMotion: React.FC<StyleInMotionProps> = ({
  reels: customReels,
  videos = [],
  instagram = [],
}) => {
  // Convert customer feedback videos to ReelItems
  const videoItems: ReelItem[] = useMemo(() => {
    return (videos || [])
      .filter((v) => Boolean(v && (v.video_url || v.title)))
      .map((v, i) => {
        const durationSec = Math.round(Number(v.duration_seconds) || 10);
        const durStr = `0:${String(durationSec).padStart(2, '0')}`;
        return {
          id: v.id || `video-${i}`,
          reelNumber: i + 1,
          title: v.title || `Customer Reel ${i + 1}`,
          location: v.customer_name || 'Verified Customer · Bengaluru',
          categoryTag: 'CUSTOMER FEEDBACK',
          duration: durStr,
          videoUrl: v.video_url,
          thumbnailUrl: DEFAULT_REELS[i % DEFAULT_REELS.length].thumbnailUrl,
          isInstagram: false,
        };
      });
  }, [videos]);

  // Convert Instagram Stories / Reel features to ReelItems
  const instagramItems: ReelItem[] = useMemo(() => {
    return (instagram || [])
      .filter((ig) => Boolean(ig && (ig.post_url || ig.image_url || ig.title)))
      .map((ig, i) => {
        const isReel = /instagram\.com\/(?:reel|reels)\//i.test(ig.post_url || '');
        const fallbackThumb = DEFAULT_REELS[(videoItems.length + i) % DEFAULT_REELS.length].thumbnailUrl;
        const autoThumb = getInstagramThumbnail(ig.post_url, ig.image_url) || fallbackThumb;
        const igId = instagramId(ig.post_url);
        const embedUrl = igId ? `https://www.instagram.com/reel/${igId}/embed/` : undefined;
        return {
          id: ig.id || `ig-${i}`,
          reelNumber: videoItems.length + i + 1,
          title: ig.title || (isReel ? 'Wardrobe Reel' : 'Studio Story'),
          location: 'Instagram · @vishrea.studio',
          categoryTag: isReel ? 'INSTAGRAM REEL' : 'STORIES FROM OUR WARDROBE',
          duration: isReel ? 'REEL' : 'STORY',
          videoUrl: (ig.post_url && ig.post_url.endsWith('.mp4')) ? ig.post_url : undefined,
          postUrl: ig.post_url,
          embedUrl,
          thumbnailUrl: autoThumb,
          isInstagram: true,
        };
      });
  }, [instagram, videoItems.length]);

  const hasAdminItems = videoItems.length > 0 || instagramItems.length > 0;

  // Build unified reels list:
  // If admin configured items exist, they are displayed first.
  // If total live items < 5, remaining slots are padded with default reels to maintain the balanced 5-card arc.
  // If no live items configured, default reels are shown in full.
  const reels: ReelItem[] = useMemo(() => {
    if (customReels && customReels.length >= 5) {
      return customReels;
    }

    const liveItems = [...videoItems, ...instagramItems];

    if (liveItems.length === 0) {
      return DEFAULT_REELS;
    }

    if (liveItems.length < 5) {
      const remainingNeeded = 5 - liveItems.length;
      const fillers = DEFAULT_REELS.slice(0, remainingNeeded).map((def, idx) => ({
        ...def,
        id: `filler-${def.id}`,
        reelNumber: liveItems.length + idx + 1,
      }));
      const combined = [...liveItems, ...fillers];
      return combined.map((item, idx) => ({
        ...item,
        reelNumber: idx + 1,
      }));
    }

    return liveItems.map((item, idx) => ({
      ...item,
      reelNumber: idx + 1,
    }));
  }, [customReels, videoItems, instagramItems]);

  const [activeIdx, setActiveIdx] = useState(() => (hasAdminItems ? 0 : 4));
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [inlinePlayingId, setInlinePlayingId] = useState<string | null>(null);
  const [fullscreenReel, setFullscreenReel] = useState<ReelItem | null>(null);

  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);

  const total = reels.length;

  const goNext = useCallback(() => {
    setActiveIdx((prev) => (prev + 1) % total);
    setProgress(0);
    setInlinePlayingId(null);
  }, [total]);

  const goPrev = useCallback(() => {
    setActiveIdx((prev) => (prev - 1 + total) % total);
    setProgress(0);
    setInlinePlayingId(null);
  }, [total]);

  // Autoplay every 4s with gold progress bar (pauses while a video is playing inline or fullscreen)
  useEffect(() => {
    if (!isPlaying || inlinePlayingId !== null || fullscreenReel !== null) {
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
  }, [isPlaying, inlinePlayingId, fullscreenReel, goNext]);

  // Close playback on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInlinePlayingId(null);
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

  // Tapping play on the slide plays right here on this slide itself
  const handlePlayItem = (reel: ReelItem) => {
    setInlinePlayingId((prev) => (prev === reel.id ? null : reel.id));
  };

  return (
    <section className="vishrea-section" id="socialProof" aria-labelledby="social-title">
      {/* Head with Title and Controls top-right matching Render */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '36px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ display: 'inline-block', width: '20px', height: '1.5px', backgroundColor: '#C9984A' }} aria-hidden="true" />
            <p className="vishrea-sub" style={{ margin: 0 }}>
              {hasAdminItems ? 'STORIES FROM OUR WARDROBE · REELS' : 'WORN BY OUR CUSTOMERS'}
            </p>
          </div>
          <h2 id="social-title" className="vishrea-headline">
            Real women,<br />
            real <span className="vishrea-gradient-text">wardrobes.</span>
          </h2>
        </div>

        <div>
          <p className="vishrea-sub" style={{ textAlign: 'right', marginBottom: '14px', maxWidth: '42ch', textTransform: 'none', fontSize: '0.92rem' }}>
            Stories from our wardrobe, Instagram features, and customer reels. Tap the centre reel to play.
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
          setInlinePlayingId(null);
        }}
        gap={200}
        lift={10}
        rot={7}
        fade={0.15}
        blur={false}
        centreScale={1.08}
        stageHeight={500}
        ariaLabel="Reels 3D carousel"
        onItemClick={(item) => handlePlayItem(item)}
        renderItem={(reel, k, { isActive }) => {
          const isInlinePlaying = isActive && inlinePlayingId === reel.id;

          if (isInlinePlaying) {
            return (
              <div
                className="vishrea-reel-card is-playing"
                style={{
                  border: '2px solid rgba(201, 152, 74, 0.95)',
                }}
              >
                <div className="vishrea-reel-inline-player">
                  {reel.isInstagram && reel.embedUrl ? (
                    <iframe
                      src={reel.embedUrl}
                      title={reel.title || 'Instagram reel'}
                      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                      scrolling="no"
                      className="vishrea-reel-iframe"
                    />
                  ) : reel.videoUrl ? (
                    <video
                      src={reel.videoUrl}
                      autoPlay
                      controls
                      playsInline
                      className="vishrea-reel-inline-video"
                    />
                  ) : (
                    <img
                      src={reel.thumbnailUrl}
                      alt={`${reel.title} — Curated Bengaluru Womenswear, Vishrea Studio`}
                      className="vishrea-reel-cover-img"
                      width="280"
                      height="498"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <button
                    type="button"
                    className="vishrea-reel-stop-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInlinePlayingId(null);
                    }}
                    aria-label="Close video and return to cover"
                    title="Close"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              className="vishrea-reel-card"
              style={{
                border: isActive ? '2px solid rgba(201, 152, 74, 0.7)' : '1px solid rgba(255, 255, 255, 0.15)',
              }}
            >
              {/* Real Cover Image: guaranteed fallback to prevent any transparency */}
              <img
                src={reel.thumbnailUrl}
                alt={`${reel.title} — Curated Bengaluru Womenswear Silhouette, Vishrea Studio`}
                className="vishrea-reel-cover-img"
                width="280"
                height="498"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const target = e.currentTarget;
                  const fallback = DEFAULT_REELS[k % DEFAULT_REELS.length].thumbnailUrl;
                  if (target.src !== fallback) {
                    target.src = fallback;
                  }
                }}
              />

              {/* If it's a real uploaded customer video and active, play it muted inside the card */}
              {isActive && reel.videoUrl && !reel.isInstagram && (
                <video
                  src={reel.videoUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="none"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 0,
                  }}
                />
              )}

              {/* Center card shows play button */}
              {isActive && (
                <button
                  type="button"
                  className="vishrea-reel-play-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlayItem(reel);
                  }}
                  aria-label={reel.isInstagram && !reel.videoUrl ? `Play ${reel.title} here` : `Play ${reel.title} here`}
                  title="Play"
                >
                  {reel.isInstagram && !reel.videoUrl ? (
                    <InstagramIcon size={24} />
                  ) : (
                    <PlayIcon size={24} />
                  )}
                </button>
              )}

              {/* Reel Content Details */}
              <div className="vishrea-reel-content">
                <div className="vishrea-reel-eyebrow">
                  <span>
                    {reel.isInstagram
                      ? (reel.categoryTag?.includes('STORY') ? 'STORY' : 'REEL')
                      : (reel.categoryTag === 'CUSTOMER FEEDBACK' ? 'CUSTOMER' : 'REEL')} 0{reel.reelNumber}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    {reel.isInstagram && <InstagramIcon size={12} />}
                    <span>{reel.duration}</span>
                  </span>
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
          );
        }}
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

              {/* Play directly on this page itself: Instagram Reel or MP4 Video */}
              {fullscreenReel.isInstagram && fullscreenReel.embedUrl ? (
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <iframe
                    src={fullscreenReel.embedUrl}
                    title={fullscreenReel.title || 'Instagram reel'}
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    scrolling="no"
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      borderRadius: '24px',
                      display: 'block',
                      backgroundColor: '#000000',
                    }}
                  />
                </div>
              ) : fullscreenReel.videoUrl ? (
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
              ) : (
                <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#140f11' }}>
                  <img
                    src={fullscreenReel.thumbnailUrl}
                    alt={`${fullscreenReel.title} — Curated Bengaluru Womenswear, Vishrea Studio`}
                    width="400"
                    height="710"
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              )}

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
