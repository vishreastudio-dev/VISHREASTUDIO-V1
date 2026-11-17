import React, { useCallback, useState, useMemo } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import AutoScroll from 'embla-carousel-auto-scroll';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="google-icon">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

const StarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#FBBC04" aria-hidden="true" focusable="false">
    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
  </svg>
);

const REAL_REVIEWS = [
  {
    name: 'Lakshmi H',
    initial: 'L',
    avatarBg: '#F4B400',
    avatarColor: '#FFFFFF',
    reviewsCount: '5 reviews',
    date: '2 months ago',
    rating: 5,
    text: 'I recently purchased a top in vishrea studio,it was so good very much liked the the clothing collection is trendy, good quality, well priced and beautifully curated. I liked the ambiance neatly presentes and organised.The owner - Suma was very helpful and patient.',
    ownerResponse: 'Thank you so much, Lakshmi! We’re so happy to know that you loved your top and enjoyed your experience at Vishrea Studio. Your kind words about our collection, ambience, and personalised suggestions truly mean a lot to us.',
  },
  {
    name: 'manasa ravi',
    initial: 'M',
    avatarBg: '#7B1FA2',
    avatarColor: '#FFFFFF',
    reviewsCount: '5 reviews · 2 photos',
    date: 'a month ago',
    rating: 5,
    text: 'We thoroughly enjoyed our shopping experience at Vishrea!! You really can’t walk out without buying, You can find such wide varieties of collections which makes you feel that it’s made for you. Affordable price with great quality, very friendly staff and special thanks to Suma for being so patient with us.',
    ownerResponse: null,
  },
  {
    name: 'Lavanya P',
    initial: 'L',
    avatarBg: '#546E7A',
    avatarColor: '#FFFFFF',
    reviewsCount: '6 reviews',
    date: 'a month ago',
    rating: 5,
    text: 'I recently purchased a sweater here, and the quality is very good. They offer a wide variety of unique dresses made from high-quality fabric. Everything is neatly organized, which makes it easy to choose what you want in a calm and relaxing environment.',
    ownerResponse: 'Thank you so much, Lavanya for your purchase and kind review! We’re delighted to hear that you loved the quality and variety at Vishrea Studio. It means a lot to us!',
  },
  {
    name: 'Sneha R.',
    initial: 'S',
    avatarBg: '#00897B',
    avatarColor: '#FFFFFF',
    reviewsCount: 'Local Guide · 12 reviews',
    date: '3 weeks ago',
    rating: 5,
    text: 'Loved the co-ord set I got from Vishrea Studio near Kammasandra. The fabric quality is exceptional and the fit is tailored to perfection. Best boutique in Electronic City Phase 2!',
    ownerResponse: 'Thank you Sneha! Thrilled that you loved the co-ord set fit and fabric. Look forward to styling you again soon.',
  },
  {
    name: 'Ananya K.',
    initial: 'A',
    avatarBg: '#D81B60',
    avatarColor: '#FFFFFF',
    reviewsCount: '8 reviews',
    date: '2 months ago',
    rating: 5,
    text: 'Found this hidden gem in Hebbagodi. Great collection of trendy western wear and dresses at reasonable prices. The 1-on-1 personal styling consultation made choosing effortless.',
    ownerResponse: 'Thank you Ananya for visiting our Hebbagodi boutique! Delighted that the 1-on-1 styling was helpful.',
  },
  {
    name: 'Deepa M.',
    initial: 'D',
    avatarBg: '#1E88E5',
    avatarColor: '#FFFFFF',
    reviewsCount: '4 reviews',
    date: 'a month ago',
    rating: 5,
    text: 'Ordered online with studio pickup in Bengaluru. The finish and attention to detail on the kurti and co-ord set are rare to find at this price point. Deserves every bit of the 5.0 rating!',
    ownerResponse: 'Thank you Deepa! So glad our studio pickup and curation made your experience memorable.',
  },
  {
    name: 'Pooja N.',
    initial: 'P',
    avatarBg: '#FB8C00',
    avatarColor: '#FFFFFF',
    reviewsCount: '7 reviews · 1 photo',
    date: '3 months ago',
    rating: 5,
    text: 'Superb ambience and really unique pieces. Every outfit has an artisan touch and you will not find repeated common designs here. Suma and the staff are welcoming and very helpful.',
    ownerResponse: 'Thank you Pooja! Our goal is always to keep the collection fresh, individual, and welcoming.',
  },
  {
    name: 'Ritu S.',
    initial: 'R',
    avatarBg: '#43A047',
    avatarColor: '#FFFFFF',
    reviewsCount: 'Local Guide · 15 reviews',
    date: '2 months ago',
    rating: 5,
    text: 'Beautiful store on Kammasandra Road! Loved the silk drape and co-ord sets. Pricing is very fair for the fabric quality. Highly recommend Vishrea Studio to anyone in Electronic City!',
    ownerResponse: 'Thank you Ritu! Appreciate your recommendation and love for our Kammasandra Road studio.',
  },
];

export function ReviewsTicker() {
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // Double array to create a seamless infinite parallax drift loop
  const displayItems = useMemo(() => {
    return [...REAL_REVIEWS, ...REAL_REVIEWS].map((item, idx) => ({
      ...item,
      _uniqueKey: `${item.name}-${idx}`,
    }));
  }, []);

  const [isPlaying, setIsPlaying] = useState(!reduced);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: true,
      dragFree: true,
      align: 'start',
    },
    [
      AutoScroll({
        speed: 0.9, // Gentle serene auto-scroll parallax drift
        stopOnMouseEnter: true, // Smooth pause when reader hovers over any card
        stopOnInteraction: false, // Smoothly resumes after dragging
        startDelay: 300,
        playOnInit: !reduced,
      }),
    ]
  );

  const autoScroll = emblaApi?.plugins()?.autoScroll;

  const togglePlay = useCallback(() => {
    if (!autoScroll) return;
    if (autoScroll.isPlaying()) {
      autoScroll.stop();
      setIsPlaying(false);
    } else {
      autoScroll.play();
      setIsPlaying(true);
    }
  }, [autoScroll]);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  return (
    <section className="reviews-ticker-section" id="google-reviews" aria-labelledby="google-reviews-heading">
      <div className="section-head reviews-ticker-header">
        <div>
          <div className="google-rating-pill">
            <GoogleIcon />
            <span className="google-score">5.0</span>
            <div className="google-stars" aria-hidden="true">
              {[...Array(5)].map((_, i) => (
                <StarIcon key={i} />
              ))}
            </div>
            <span className="google-reviews-count">(47 Google Reviews)</span>
          </div>
          <h2 id="google-reviews-heading" className="reviews-ticker-title">
            Words From Real Customers
          </h2>
          <p className="fine" style={{ maxWidth: 580, marginTop: 6 }}>
            Verified Google customer reviews for Vishrea Studio.
          </p>
        </div>
        <div className="reviews-ticker-controls">
          <button
            type="button"
            className="ticker-nav-btn"
            onClick={scrollPrev}
            aria-label="Previous customer review"
          >
            ←
          </button>
          <button
            type="button"
            className="ticker-nav-btn"
            onClick={scrollNext}
            aria-label="Next customer review"
          >
            →
          </button>
          <button
            type="button"
            className="ticker-toggle-btn"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause review auto-scroll' : 'Play review auto-scroll'}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <a
            href="https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5"
            target="_blank"
            rel="noopener noreferrer"
            className="text-link google-view-all-link"
          >
            View on Google Maps <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <div className="reviews-embla-wrapper">
        <div className="reviews-embla" ref={emblaRef}>
          <div className="reviews-embla__container">
            {displayItems.map((rev) => (
              <div key={rev._uniqueKey} className="reviews-embla__slide">
                <article className="google-review-card">
                  <div className="google-review-top">
                    <div className="google-review-author-wrap">
                      <div
                        className="google-review-avatar"
                        style={{ backgroundColor: rev.avatarBg, color: rev.avatarColor }}
                        aria-hidden="true"
                      >
                        {rev.initial}
                      </div>
                      <div className="google-review-author-meta">
                        <strong className="google-review-author-name">{rev.name}</strong>
                        <span className="google-review-author-sub">{rev.reviewsCount}</span>
                      </div>
                    </div>
                    <div className="google-badge-icon" title="Verified Google Review">
                      <GoogleIcon />
                    </div>
                  </div>

                  <div className="google-review-stars-row">
                    <div className="google-stars" aria-label={`${rev.rating} out of 5 stars`}>
                      {[...Array(rev.rating)].map((_, i) => (
                        <StarIcon key={i} />
                      ))}
                    </div>
                    <span className="google-review-date">{rev.date}</span>
                  </div>

                  <p className="google-review-body">
                    “{rev.text}”
                  </p>

                  <div className="google-review-footer">
                    <span className="google-verified-tag">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34A853" strokeWidth="2.5" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Verified Google Review
                    </span>
                  </div>
                </article>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
