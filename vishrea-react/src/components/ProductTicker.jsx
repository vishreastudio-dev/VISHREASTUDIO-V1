import React, { useCallback, useEffect, useState, useMemo } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import AutoScroll from 'embla-carousel-auto-scroll';
import { ProductCard } from './ProductCard';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ProductTicker({ products = [] }) {
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // Duplicate items if fewer than 8 so the continuous ticker track loops seamlessly without gaps
  const displayItems = useMemo(() => {
    if (!products.length) return [];
    if (products.length >= 8) return products;
    const repeatCount = Math.ceil(10 / products.length);
    const list = [];
    for (let r = 0; r < repeatCount; r++) {
      products.forEach((p, idx) => {
        list.push({ ...p, _uniqueKey: `${p.id || idx}-drift-${r}` });
      });
    }
    return list;
  }, [products]);

  const [isPlaying, setIsPlaying] = useState(!reduced);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: true,
      dragFree: true,
      align: 'start',
    },
    [
      AutoScroll({
        speed: 1.0, // Quiet luxury serene drift speed
        stopOnMouseEnter: true, // Pause immediately when hovering over a card
        stopOnInteraction: false, // Resume gliding smoothly after user touch/drag
        startDelay: 400,
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

  useEffect(() => {
    if (!emblaApi || !autoScroll) return;
    setIsPlaying(autoScroll.isPlaying());
    const onPlay = () => setIsPlaying(true);
    const onStop = () => setIsPlaying(false);
    emblaApi.on('autoScroll:play', onPlay);
    emblaApi.on('autoScroll:stop', onStop);
    return () => {
      emblaApi.off('autoScroll:play', onPlay);
      emblaApi.off('autoScroll:stop', onStop);
    };
  }, [emblaApi, autoScroll]);

  if (!products.length) return null;

  return (
    <div className="product-ticker-wrap">
      <div className="embla-ticker" ref={emblaRef} tabIndex={0} aria-label="New arrivals runway showcase">
        <div className="embla-ticker__container">
          {displayItems.map((p) => (
            <div key={p._uniqueKey || p.id} className="embla-ticker__slide">
              <ProductCard product={p} showAvailability eager={false} />
            </div>
          ))}
        </div>
      </div>

      <div className="product-ticker-controls">
        <button
          type="button"
          className="ticker-nav-btn prev"
          onClick={scrollPrev}
          aria-label="Previous pieces"
          title="Previous piece"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          className="ticker-toggle-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause runway ticker' : 'Resume runway ticker'}
          title={isPlaying ? 'Pause runway ticker' : 'Resume runway ticker'}
        >
          {isPlaying ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="5" y="4" width="4" height="16" />
              <rect x="15" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="6 4 19 12 6 20 6 4" />
            </svg>
          )}
          <span className="ticker-toggle-label">{isPlaying ? 'Pause Runway' : 'Play Runway'}</span>
        </button>
        <button
          type="button"
          className="ticker-nav-btn next"
          onClick={scrollNext}
          aria-label="Next pieces"
          title="Next piece"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
