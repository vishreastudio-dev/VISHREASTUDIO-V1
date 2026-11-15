import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { ProductTicker } from '../components/ProductTicker';
import { HeroCarousel } from '../components/HeroCarousel';
import { ErrorState, LoadingState } from '../components/Status';
import { useApi } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { itemListSchema } from '../lib/schema';
import { SITE } from '../site.config.js';

const CATEGORIES = [
  { slug: 'dresses', name: 'Dresses', tagline: 'ELEGANT • TIMELESS • YOU', cls: 'cat-dresses' },
  { slug: 'coord-sets', name: 'Co-ord Sets', tagline: 'MATCH • STYLE • REPEAT', cls: 'cat-coords' },
  { slug: 'tops', name: 'Tops', tagline: 'CHIC • VERSATILE • MODERN', cls: 'cat-tops' },
  { slug: 'pants', name: 'Trousers', tagline: 'COMFORT • STYLE • CONFIDENCE', cls: 'cat-pants' },
  { slug: 'party-dresses', name: 'Party Dresses', tagline: 'CELEBRATE • SPARKLE • SHINE', cls: 'cat-party' },
];

const instagramId = (url) => (String(url || '').match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/) || [])[1] || null;

// The server marks the first page load with whether a carousel is live ("live" / "none"), so the
// homepage draws the right hero at once. Later visits within the app always ask the API.
let heroHint = typeof document !== 'undefined' ? document.querySelector('meta[name="hero-carousel"]')?.getAttribute('content') : undefined;
const takeHeroHint = () => {
  const h = heroHint;
  heroHint = undefined;
  return h;
};

/** The original homepage hero, shown whenever no carousel slide is live. */
const StaticHero = () => (
  <section className="hero">
    <div className="hero-copy">
      <p className="eyebrow">Vishrea Studio · Bengaluru</p>
      <h1>
        Wear what feels<br />
        <em>like you.</em>
      </h1>
      <p className="hero-text">
        Womenswear chosen one piece at a time. Most of what you see here exists in a single size — when it’s gone, it’s gone.
      </p>
      <div className="hero-actions">
        <Link className="button button-dark" to="/catalogue">Shop new arrivals</Link>
      </div>
    </div>
    <div className="hero-image">
      <img
        src="/assets/hero-editorial.jpg"
        alt="Model in a draped chocolate-brown and ivory silk drape, standing in a stone archway"
        loading="eager"
        fetchPriority="high"
        width="1200"
        height="896"
      />
    </div>
  </section>
);

function HomeHero() {
  const [hint] = useState(takeHeroHint);
  const req = useApi('/api/homepage-carousel', { enabled: hint !== 'none', maxAge: 30_000 });
  if (hint === 'none') return <StaticHero />;
  if (req.loading && !req.data) return <div className="hero-carousel-placeholder" aria-hidden="true" />;
  const slides = req.data?.slides || [];
  if (req.error || !slides.length) return <StaticHero />;
  const first = slides[0];
  const firstHasHeading = first.display_mode !== 'image_only' && first.visibility.heading && first.heading;
  return (
    <>
      {!firstHasHeading && <h1 className="visually-hidden">Vishrea Studio: womenswear chosen one piece at a time</h1>}
      <HeroCarousel slides={slides} settings={req.data.settings} firstHeadingLevel={firstHasHeading ? 1 : 2} />
    </>
  );
}

export const Home = () => {
  const featuredReq = useApi('/api/catalogue?new_arrivals=true&limit=10', { maxAge: 15_000 });
  const contentReq = useApi('/api/content', { maxAge: 60_000 });
  const featured = featuredReq.data?.products || [];
  const videos = contentReq.data?.feedback_videos || [];
  const instagram = contentReq.data?.instagram || [];
  const [playing, setPlaying] = useState({});
  const videoRefs = useRef({});

  usePageSeo({ schema: featured.length ? itemListSchema(SITE.url + '/', featured) : null, ready: !featuredReq.loading });

  // Autoplay IG reels and feedback videos when they enter the viewport
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const vid = entry.target;
          if (entry.isIntersecting) {
            vid.muted = true;
            vid.play().catch(() => { });
          } else {
            vid.pause();
          }
        });
      },
      { threshold: 0.25 }
    );
    Object.values(videoRefs.current).forEach((el) => {
      if (el) {
        el.muted = true;
        observer.observe(el);
      }
    });
    return () => observer.disconnect();
  }, [videos.length]);

  const toggleVideo = (id) => {
    const vid = videoRefs.current[id];
    if (!vid) return;
    if (vid.paused) {
      vid.muted = false;
      vid.play().catch(() => {
        vid.muted = true;
        vid.play().catch(() => { });
      });
    } else {
      vid.pause();
    }
  };

  return (
    <div className="home-page">
      <Header />
      <main id="main-content">
        <HomeHero />

        <section className="section collections" id="collections" aria-labelledby="collections-title">
          <div className="category-mosaic-grid">
            <div className="category-mosaic-hero">
              <div className="category-mosaic-eyebrow">
                <span className="category-gold-dash" aria-hidden="true" />
                <span>EXPLORE CATEGORIES</span>
              </div>
              <h2 id="collections-title" className="category-mosaic-heading">
                Start with what<br />
                you reach for.
              </h2>
              <p className="category-mosaic-text">
                Discover our curated edit of styles for every mood and moment.
              </p>
              <Link className="category-mosaic-btn" to="/catalogue">
                <span>VIEW ALL CATEGORIES</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>

            {CATEGORIES.map((cat) => (
              <Link key={cat.slug} className={`category-mosaic-card ${cat.cls}`} to={`/catalogue/${cat.slug}`}>
                <div className="category-mosaic-card-content">
                  <div>
                    <span className="category-card-accent" aria-hidden="true" />
                    <h3 className="category-card-title">{cat.name}</h3>
                    <p className="category-card-tagline">{cat.tagline}</p>
                  </div>
                  <div className="category-card-arrow" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="category-mosaic-footer" aria-hidden="true">
            <span className="footer-star">✦</span>
            <span className="footer-line" />
            <span className="footer-text">FASHION FOR EVERY YOU</span>
            <span className="footer-line" />
          </div>
        </section>

        <section className="section product-section" id="shop" aria-labelledby="new-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">Just in</p>
              <h2 id="new-title">New arrivals</h2>
            </div>
            <Link className="text-link" to="/catalogue?sort=newest">See everything new <span aria-hidden="true">→</span></Link>
          </div>
          {featuredReq.loading ? (
            <LoadingState label="Loading new arrivals…" />
          ) : featuredReq.error && !featured.length ? (
            <ErrorState error={featuredReq.error} onRetry={featuredReq.reload} title="We couldn’t load new arrivals" />
          ) : featured.length ? (
            <ProductTicker products={featured} />
          ) : (
            <p className="fine">
              New pieces are being photographed. <Link className="text-link" to="/catalogue">Browse the current edit</Link>
            </p>
          )}
        </section>

        <section className="editorial-strip" aria-labelledby="membership-title">
          <div>
            <p className="eyebrow">Walkin Wardrobe membership</p>
            <h2 id="membership-title">A wardrobe that keeps moving with you.</h2>
            <p>₹1,799 a month for four wardrobe credits each paid month and free studio pickup. Stay a member into your 6th month and one piece is free.</p>
            <Link className="button button-light" to="/membership">How membership works</Link>
          </div>
          <img
            src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80"
            alt=""
            loading="lazy"
            decoding="async"
            width="1200"
            height="1500"
          />
        </section>

        <section className="section story" id="story" aria-labelledby="story-title">
          <div className="story-copy">
            <p className="eyebrow">About the studio</p>
            <h2 id="story-title">
              Fewer pieces.<br />
              Chosen properly.
            </h2>
            <p>
              Vishrea is a womenswear studio in Bengaluru. Most pieces are one-of-one, so the edit changes from week to week.
              Pick up from the studio for free, or have it delivered anywhere in India.
            </p>
            <Link className="text-link" to="/contact">Visiting, delivery and exchanges <span aria-hidden="true">→</span></Link>
          </div>
          <div className="story-panel">
            <img
              src="https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=1000&q=80"
              alt=""
              loading="lazy"
              decoding="async"
              width="1000"
              height="1250"
            />
          </div>
        </section>

        {(videos.length > 0 || instagram.length > 0) && (
          <section className="section" id="socialProof" aria-labelledby="social-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Worn by our customers</p>
                <h2 id="social-title">Real women, real wardrobes.</h2>
              </div>
            </div>
            <div className="social-content">
              {videos.map((v) => (
                <figure key={v.id} className="social-card">
                  <div className="social-media">
                    <video
                      ref={(el) => {
                        if (el) {
                          videoRefs.current[v.id] = el;
                          el.muted = true;
                          el.play().catch(() => { });
                        }
                      }}
                      src={v.video_url}
                      autoPlay
                      playsInline
                      muted
                      loop
                      preload="auto"
                      onPlay={() => setPlaying((s) => ({ ...s, [v.id]: true }))}
                      onPause={() => setPlaying((s) => ({ ...s, [v.id]: false }))}
                      aria-label={v.title || 'Customer video'}
                    />
                    <button type="button" className="video-toggle" onClick={() => toggleVideo(v.id)} aria-label={playing[v.id] ? 'Pause video' : 'Play video'}>
                      {playing[v.id] ? 'Pause' : 'Play'}
                    </button>
                  </div>
                  <figcaption className="social-card-footer">
                    <strong>{v.title || 'In the studio'}</strong>
                    {v.customer_name && <span>{v.customer_name}</span>}
                  </figcaption>
                </figure>
              ))}
              {instagram.map((v) => {
                const id = instagramId(v.post_url);
                const isReel = /instagram\.com\/(?:reel|reels)\//.test(v.post_url);
                const embedSrc = id
                  ? (isReel ? `https://www.instagram.com/reel/${id}/embed/` : `https://www.instagram.com/p/${id}/embed/`)
                  : null;
                return (
                  <figure key={v.id} className={`social-card ${embedSrc ? 'social-card-embed' : ''}`}>
                    <div className="social-media">
                      {embedSrc ? (
                        <iframe
                          src={embedSrc}
                          loading="eager"
                          title={v.title || 'Instagram reel'}
                          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                          scrolling="no"
                        />
                      ) : v.image_url ? (
                        <img src={v.image_url} alt={v.title || 'Vishrea Studio on Instagram'} loading="lazy" />
                      ) : null}
                    </div>
                    {!embedSrc && (
                      <figcaption className="social-card-footer">
                        <a href={v.post_url} target="_blank" rel="noopener noreferrer">{v.title || 'On Instagram'}</a>
                      </figcaption>
                    )}
                  </figure>
                );
              })}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};
