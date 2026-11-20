import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { FeelTheDrapeProps } from './types';
import './home-sections.css';

// Drone video tour of Vishrea Studio Bengaluru
const FALLBACK_VIDEO_URL = '/assets/vishrea-drone.mp4';

// SVG Icons (Strictly no emojis)
const VolumeXIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const Volume2Icon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

export const FeelTheDrape: React.FC<FeelTheDrapeProps> = ({
  imageUrl = '/assets/studio-storefront.jpg',
  videoUrl = '/assets/vishrea-drone.mp4',
}) => {
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => { });
    }
  }, []);

  const toggleSound = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      videoRef.current.play().catch(() => { });
    }
  };

  return (
    <section className="vsh-editorial-section" id="story" aria-labelledby="story-heading">

      {/* ── Centered top header ── */}
      <div className="vsh-editorial-header">
        <p className="vsh-editorial-eyebrow">ABOUT THE STUDIO · BENGALURU</p>
        <h2 id="story-heading" className="vsh-editorial-h1">
          Fewer Pieces. <em>Chosen Properly.</em>
        </h2>
        <p className="vsh-editorial-subtitle">
          Feel the drape, touch the textures, and discover the craftsmanship behind each curated silhouette.
        </p>
      </div>

      {/* ── Asymmetric two-column body ── */}
      <div className="vsh-editorial-body">

        {/* LEFT: Image with brackets */}
        <div className="vsh-editorial-left">
          <div className="vsh-frame">
            {/* Corner brackets */}
            <span className="vsh-bracket vsh-bracket--tl" aria-hidden="true" />
            <span className="vsh-bracket vsh-bracket--tr" aria-hidden="true" />
            <span className="vsh-bracket vsh-bracket--bl" aria-hidden="true" />
            <span className="vsh-bracket vsh-bracket--br" aria-hidden="true" />

            {/* Video / image */}
            <div className="vsh-frame-media">
              <video
                ref={videoRef}
                src={videoUrl || FALLBACK_VIDEO_URL}
                autoPlay
                loop
                muted={isMuted}
                playsInline
                preload="auto"
                poster={imageUrl || '/assets/studio-storefront.jpg'}
                aria-label="Vishrea Studio boutique interior tour"
                className="vsh-frame-video"
              />

              {/* Sound toggle */}
              <button
                type="button"
                className="vsh-sound-toggle"
                onClick={toggleSound}
                aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
              >
                {isMuted ? <VolumeXIcon /> : <Volume2Icon />}
                <span>{isMuted ? 'SOUND OFF' : 'SOUND ON'}</span>
              </button>
            </div>
          </div>

          {/* Below-frame captions */}
          <div className="vsh-frame-captions">
            <span className="vsh-caption-left">Natural lime plaster · Hand-forged brass</span>
            <span className="vsh-caption-right"><em>One-of-one silhouettes</em></span>
          </div>
        </div>

        {/* RIGHT: Editorial copy */}
        <div className="vsh-editorial-right">
          <div className="vsh-curation-label">
            <span className="vsh-curation-line" aria-hidden="true" />
            <span>BESPOKE CURATION</span>
          </div>

          <p className="vsh-primary-para">
            Vishrea is a boutique womenswear studio in Bengaluru. Most pieces are one-of-one, so our curated edit changes from week to week. We focus on modern silhouettes, rich handloom textures, and thoughtful tailoring.
          </p>

          <p className="vsh-secondary-para">
            Visit our Bengaluru studio for a complimentary 1-on-1 personal styling consultation, or shop online with free studio pickup and flat ₹99 insured courier delivery across India.
          </p>

          {/* Metadata strip */}
          <div className="vsh-meta-strip">
            <div className="vsh-meta-item">
              <span className="vsh-meta-label">PRIVATE CONSULTS</span>
              <span className="vsh-meta-value">Complimentary 1-on-1</span>
            </div>
            <div className="vsh-meta-item">
              <span className="vsh-meta-label">NATIONWIDE CARE</span>
              <span className="vsh-meta-value">₹99 Insured Courier</span>
            </div>
          </div>

          {/* Action links */}
          <div className="vsh-action-links">
            <Link to="/contact" className="vsh-action-link">
              VISITING, DELIVERY AND EXCHANGES <span aria-hidden="true">—</span>
            </Link>
            <span className="vsh-action-divider" aria-hidden="true" />
            <a
              href="https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5"
              target="_blank"
              rel="noopener noreferrer"
              className="vsh-action-link"
            >
              STUDIO LOCATION ON GOOGLE MAPS <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};
