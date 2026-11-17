import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { ProductTicker } from '../components/ProductTicker';
import { HeroCarousel } from '../components/HeroCarousel';
import { ReviewsTicker } from '../components/ReviewsTicker';
import { ErrorState, LoadingState } from '../components/Status';
import { useApi } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { faqSchema, itemListSchema } from '../lib/schema';
import { HOME_LOCAL_FAQS } from '../content/faqs.js';
import { SITE } from '../site.config.js';

const CATEGORIES = [
  { slug: 'coord-sets', name: 'Co-ord Sets', tagline: 'STARTING ₹1,850 • MATCH & STYLE', cls: 'cat-coords' },
  { slug: 'dresses', name: 'Dresses', tagline: 'STARTING ₹1,450 • TIMELESS SILHOUETTES', cls: 'cat-dresses' },
  { slug: 'tops', name: 'Tops & Blouses', tagline: 'STARTING ₹1,250 • CHIC & EVERYDAY', cls: 'cat-tops' },
  { slug: 'pants', name: 'Trousers & Bottoms', tagline: 'STARTING ₹1,350 • TAILORED COMFORT', cls: 'cat-pants' },
  { slug: 'party-dresses', name: 'Occasion & Party Wear', tagline: 'STARTING ₹2,100 • ELEGANT DRAPES', cls: 'cat-party' },
];

function HomeFaqAccordion() {
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <section className="home-faq-section" id="faqs" aria-labelledby="home-faq-heading">
      <div className="home-faq-header">
        <p className="eyebrow">Frequently asked questions</p>
        <h2 id="home-faq-heading" className="home-faq-title">Everything You Need To Know</h2>
        <p className="home-faq-subtitle">
          Details on visiting our Hebbagodi boutique, personal styling consultations, and pan-India express delivery.
        </p>
      </div>
      <div className="home-faq-accordion" role="region" aria-label="Boutique FAQs">
        {HOME_LOCAL_FAQS.map((faq, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div key={faq.q} className={`home-faq-item ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="home-faq-trigger"
                aria-expanded={isOpen}
                onClick={() => setOpenIdx(isOpen ? null : idx)}
              >
                <span>{faq.q}</span>
                <span className="home-faq-indicator" aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </span>
              </button>
              {isOpen && (
                <div className="home-faq-content">
                  <p>{faq.a}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

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
const StaticHero = () => {
  const rawWa = (SITE.contact?.whatsapp || '916364116567').replace(/\D/g, '');
  const waUrl = `https://wa.me/${rawWa}?text=${encodeURIComponent('Hello Vishrea Studio! I would like to book a personal styling consultation at your Hebbagodi boutique.')}`;

  return (
    <section className="hero">
      <div className="hero-copy">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--soft, #faf9f8)', border: '1px solid var(--line, #ebe6e1)', borderRadius: 20, fontSize: 12, fontWeight: 600, color: 'var(--ink, #121112)', marginBottom: 14 }}>
          <span style={{ color: 'var(--gold, #b89560)' }}>5.0 ★</span>
          <span>47 Verified Google Reviews</span>
          <span style={{ color: 'var(--line, #ebe6e1)' }}>·</span>
          <span>Bengaluru Atelier</span>
        </div>
        <p className="eyebrow">Womenswear Studio · Bengaluru</p>
        <h1>
          Curated Luxury,<br />
          <em>Uniquely Yours.</em>
        </h1>
        <p className="hero-text">
          Womenswear chosen one piece at a time — co-ord sets, dresses, kurtis, and contemporary western wear. Enjoy complimentary 1-on-1 personal styling at our Bengaluru studio with free studio pickup and flat ₹99 pan-India delivery.
        </p>
        <div className="hero-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link className="button button-dark" to="/catalogue">Explore Collection</Link>
          <a className="button button-light" href={waUrl} target="_blank" rel="noopener noreferrer">
            Book Personal Styling
          </a>
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
};

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

  const homeSchemas = [
    featured.length ? itemListSchema(SITE.url + '/', featured) : null,
    faqSchema(SITE.url + '/', HOME_LOCAL_FAQS),
  ].filter(Boolean);

  usePageSeo({ schema: homeSchemas, ready: !featuredReq.loading });

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

        <ReviewsTicker />

        <section className="editorial-strip" aria-labelledby="membership-title">
          <div>
            <p className="eyebrow">Walkin Wardrobe membership</p>
            <h2 id="membership-title">A wardrobe that keeps moving with you.</h2>
            <p>₹1,799 a month for four wardrobe credits each paid month and free studio pickup. Stay a member into your 6th month and one piece is free.</p>
            <Link className="button button-light" to="/membership">How membership works</Link>
          </div>
          <img
            src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80"
            alt="Curated luxury fashion capsule wardrobe collection by Vishrea Studio"
            loading="lazy"
            decoding="async"
            width="1200"
            height="1500"
          />
        </section>

        <section className="section story" id="story" aria-labelledby="story-title">
          <div className="story-copy">
            <p className="eyebrow">About The Studio · Bengaluru</p>
            <h2 id="story-title">
              Fewer Pieces.<br />
              Chosen Properly.
            </h2>
            <p>
              Vishrea is an independent womenswear studio in Bengaluru. Most pieces are one-of-one, so our curated edit changes from week to week. We focus on modern silhouettes, rich handloom textures, and thoughtful tailoring.
            </p>
            <p>
              Visit our Bengaluru studio for a complimentary 1-on-1 personal styling consultation, or shop online with free studio pickup and flat ₹99 insured courier delivery across India.
            </p>
            <div style={{ display: 'flex', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
              <Link className="text-link" to="/contact">Visiting, delivery and exchanges <span aria-hidden="true">→</span></Link>
              <a className="text-link" href="https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5" target="_blank" rel="noopener noreferrer">Studio location on Google Maps <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div className="story-panel">
            <img
              src="https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=1000&q=80"
              alt="Vishrea Studio atelier craftsmanship and designer womenswear curation in Bengaluru"
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

        <HomeFaqAccordion />
      </main>
      <Footer />
    </div>
  );
};
