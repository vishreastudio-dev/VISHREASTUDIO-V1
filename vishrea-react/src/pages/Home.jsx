import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { HeroCarousel } from '../components/HeroCarousel';
import { ReviewsTicker } from '../components/ReviewsTicker';
import { useApi } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { faqSchema, itemListSchema, organizationSchema, websiteSchema } from '../lib/schema';
import { HOME_LOCAL_FAQS } from '../content/faqs.js';
import { SITE } from '../site.config.js';
import { useStore } from '../context/StoreContext';
import { api } from '../lib/api';
import { TryTheLook } from '../components/home/TryTheLook';
import { PickAPiece } from '../components/home/PickAPiece';
import { FeelTheDrape } from '../components/home/FeelTheDrape';
import { StyleInMotion } from '../components/home/StyleInMotion';
import { HomeFaqAccordion } from '../components/home/HomeFaqAccordion';

const CATEGORIES = [
  { slug: 'coord-sets', name: 'Co-ord Sets', tagline: 'STARTING ₹1,850 • MATCH & STYLE', cls: 'cat-coords' },
  { slug: 'dresses', name: 'Dresses', tagline: 'STARTING ₹1,450 • TIMELESS SILHOUETTES', cls: 'cat-dresses' },
  { slug: 'tops', name: 'Tops & Blouses', tagline: 'STARTING ₹1,250 • CHIC & EVERYDAY', cls: 'cat-tops' },
  { slug: 'pants', name: 'Trousers & Bottoms', tagline: 'STARTING ₹1,350 • TAILORED COMFORT', cls: 'cat-pants' },
  { slug: 'party-dresses', name: 'Occasion & Party Wear', tagline: 'STARTING ₹2,100 • ELEGANT DRAPES', cls: 'cat-party' },
];

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
  const { addToCart, user } = useStore();
  const featuredReq = useApi('/api/catalogue?new_arrivals=true&limit=24', { maxAge: 15_000 });
  const contentReq = useApi('/api/content', { maxAge: 60_000 });
  const featured = featuredReq.data?.products || [];
  const videos = contentReq.data?.feedback_videos || [];
  const instagram = contentReq.data?.instagram || [];

  const homeSchemas = [
    organizationSchema(),
    websiteSchema(),
    featured.length ? itemListSchema(SITE.url + '/', featured) : null,
    faqSchema(SITE.url + '/', HOME_LOCAL_FAQS),
  ].filter(Boolean);

  usePageSeo({ schema: homeSchemas, ready: !featuredReq.loading });

  const handleAddToBag = async (piece) => {
    // Wardrobe bag pulse animation on bag icon
    const bagButton = document.querySelector('.bag-button') || document.querySelector('#bag') || document.querySelector('#bagCount');
    if (bagButton) {
      bagButton.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.28) rotate(-8deg)' },
          { transform: 'scale(0.94)' },
          { transform: 'scale(1)' },
        ],
        { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }

    const product = piece?.product || piece;
    if (!product) return;

    try {
      let targetVariant = product.variants?.find((v) => v.stock_quantity > 0 || v.in_stock) || product.variants?.[0];
      if (!targetVariant && product.slug) {
        try {
          const d = await api(`/api/product?slug=${encodeURIComponent(product.slug)}`);
          const fullProd = d?.product || product;
          targetVariant = fullProd?.variants?.find((v) => v.stock_quantity > 0 || v.in_stock) || fullProd?.variants?.[0];
        } catch {}
      }

      if (!targetVariant) {
        targetVariant = {
          id: `v-${product.id || 'piece'}`,
          size_label: product.sizes?.[0] || 'Free Size',
          effective_price: product.price_inr || 2490,
          available_quantity: 1,
        };
      }

      await addToCart({ product, variant: targetVariant, quantity: 1 });
    } catch (err) {
      console.error('Failed to add to bag:', err);
    }
  };

  const handleAddFullLook = async (pieces) => {
    if (!Array.isArray(pieces)) return;
    for (const p of pieces) {
      await handleAddToBag(p);
    }
  };

  return (
    <div className="home-page">
      <Header />
      <main id="main-content">
        {/* 1. Home Hero / Carousel */}
        <HomeHero />

        {/* 2. JUST IN · STYLED HEAD TO TOE (Shared Arc Engine) */}
        <TryTheLook
          products={featured}
          user={user}
          onAddToBag={handleAddToBag}
          onAddFullLook={handleAddFullLook}
        />

        {/* 3. EXPLORE CATEGORIES (Fanned Arc, 3D Cursor Tilt, Spring Add) */}
        <PickAPiece
          categories={CATEGORIES}
          onAddToBag={handleAddToBag}
        />

        {/* 4. Words From Real Customers (Retained content & functionality) */}
        <ReviewsTicker />

        {/* 5. Walkin Wardrobe Membership (Retained content & functionality) */}
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

        {/* 6. ABOUT THE STUDIO · BENGALURU (Storefront drone video tour in gold frame, Scrolling photo stream) */}
        <FeelTheDrape
          videoUrl="/assets/vishrea-drone.mp4"
          imageUrl="/assets/studio-storefront.jpg"
        />

        {/* 7. WORN BY OUR CUSTOMERS / STORIES FROM OUR WARDROBE (3D Reel Arc, Autoplay 4s, Fullscreen Player) */}
        <StyleInMotion
          videos={videos}
          instagram={instagram}
        />

        {/* 8. FREQUENTLY ASKED QUESTIONS (Compact Accordion UI) */}
        <HomeFaqAccordion
          faqs={HOME_LOCAL_FAQS}
        />
      </main>
      <Footer />
    </div>
  );
};
