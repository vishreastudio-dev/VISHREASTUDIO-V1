// Homepage hero carousel. Renders published slides on the homepage and the live preview in the
// admin editor, so both always look the same. Each slide has two independent layers: the banner
// image (a transform-ready media layer, kept separate for a later parallax effect) and the text
// and buttons, rendered as real HTML from the slide's settings. Breakpoints use container queries,
// so a preview frame of phone width lays out exactly like a phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import Fade from 'embla-carousel-fade';
import Autoplay from 'embla-carousel-autoplay';
import { HERO_FONTS, ctaLink, emblaDuration, naturalRatios, tabletSize } from '../lib/heroCarousel';

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };
const ALIGN_Y = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

const rgba = (hex, opacity) => {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
};

function scrim(pos, color, opacity) {
  const o = opacity / 100;
  const stops = `${rgba(color, o)} 0%, ${rgba(color, o * 0.55)} 40%, ${rgba(color, 0)} 78%`;
  if (pos.x === 'left') return `linear-gradient(to right, ${stops})`;
  if (pos.x === 'right') return `linear-gradient(to left, ${stops})`;
  if (pos.y === 'top') return `linear-gradient(to bottom, ${stops})`;
  if (pos.y === 'bottom') return `linear-gradient(to top, ${stops})`;
  return `radial-gradient(ellipse at center, ${rgba(color, o)} 0%, ${rgba(color, 0)} 70%)`;
}

function textStyle(st) {
  return {
    fontFamily: HERO_FONTS[st.font]?.stack,
    fontWeight: st.weight,
    fontStyle: st.italic ? 'italic' : 'normal',
    color: st.color,
    textAlign: st.align,
    lineHeight: st.line_height,
    letterSpacing: `${st.letter_spacing}em`,
    textTransform: st.uppercase ? 'uppercase' : 'none',
    '--fs-d': `${st.size}px`,
    '--fs-t': `${tabletSize(st)}px`,
    '--fs-m': `${st.mobile_size}px`,
  };
}

function Cta({ cta, secondary }) {
  const link = ctaLink(cta.url);
  if (!cta.visible || !cta.label || !link) return null;
  const className = `hc-cta hc-cta-${cta.size}${cta.uppercase ? ' is-upper' : ''}${secondary ? ' is-secondary' : ''}`;
  const style = { '--cta-bg': cta.bg, '--cta-color': cta.color, '--cta-border': cta.border, '--cta-bw': `${cta.border_width}px`, '--cta-radius': `${cta.radius}px` };
  if (link.internal && !cta.new_tab) return <Link className={className} style={style} to={link.href}>{cta.label}</Link>;
  return (
    <a className={className} style={style} href={link.href} {...(cta.new_tab ? { target: '_blank' } : {})} rel={link.internal ? undefined : 'noopener noreferrer'}>
      {cta.label}
      {cta.new_tab && <span className="visually-hidden"> (opens in a new tab)</span>}
    </a>
  );
}

function SlideMedia({ slide, device, eager, load }) {
  const [failed, setFailed] = useState(false);
  const { desktop_image: desktop, mobile_image: mobile, image_settings: im } = slide;
  const imgStyle = {
    // In "natural" the frame already has the image's proportions; contain guarantees no cropping
    // even when a taller neighbouring slide or long text makes the frame grow.
    objectFit: im.fit === 'cover' ? 'cover' : 'contain',
    '--fx': `${im.focal_x}%`,
    '--fy': `${im.focal_y}%`,
    '--mfx': `${im.mobile_focal_x}%`,
    '--mfy': `${im.mobile_focal_y}%`,
  };
  const forced = device === 'mobile' ? mobile || desktop : device ? desktop : null;
  const common = {
    className: 'hc-img',
    alt: slide.image_alt || '',
    style: imgStyle,
    loading: eager ? 'eager' : 'lazy',
    decoding: eager ? 'auto' : 'async',
    onError: () => setFailed(true),
    ...(eager ? { fetchPriority: 'high' } : {}),
  };
  let content = null;
  if (desktop && load && !failed) {
    content = forced ? (
      <img {...common} src={forced.url} width={forced.width || undefined} height={forced.height || undefined} />
    ) : (
      <picture>
        {mobile && <source media="(max-width: 640px)" srcSet={mobile.url} width={mobile.width || undefined} height={mobile.height || undefined} />}
        <img {...common} src={desktop.url} width={desktop.width || undefined} height={desktop.height || undefined} />
      </picture>
    );
  }
  return (
    <div className="hc-media" style={{ backgroundColor: im.background }} data-state={!desktop ? 'empty' : failed ? 'failed' : 'ok'}>
      <div className="hc-media-layer">{content}</div>
      {device && !desktop && <span className="hc-media-note">Upload a banner image</span>}
      {failed && device && <span className="hc-media-note">The banner image could not be loaded</span>}
    </div>
  );
}

function Slide({ slide, index, count, selected, device, load, headingLevel }) {
  const o = slide.overlay;
  const split = slide.layout_type !== 'full';
  const v = slide.visibility;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const overlayVars = {
    '--ox': JUSTIFY[o.desktop.x],
    '--oy': ALIGN_Y[o.desktop.y],
    '--ow': `${o.desktop.max_width}%`,
    '--oix': `${o.desktop.inset_x}%`,
    '--oiy': o.desktop.inset_y,
    '--m-ox': JUSTIFY[o.mobile.x],
    '--m-oy': ALIGN_Y[o.mobile.y],
    '--m-ow': `${o.mobile.max_width}%`,
    '--m-oix': `${o.mobile.inset_x}%`,
    '--m-oiy': o.mobile.inset_y,
    '--og': `${o.gap}px`,
    '--cta-justify': JUSTIFY[slide.heading_style.align],
  };
  const card = o.panel === 'card' ? { '--card-bg': rgba(o.panel_color, o.panel_opacity / 100) } : {};
  const hasCta = [slide.primary_cta, slide.secondary_cta].some((c) => c.visible && c.label && ctaLink(c.url));
  // No visible words or buttons means no text layer, so it never adds empty space or a backdrop.
  const showText =
    slide.display_mode !== 'image_only' && (hasCta || (v.heading && slide.heading) || (v.subtitle && slide.subtitle) || (v.description && slide.description));
  // "natural" needs the banner's size; without an image the slide falls back to the set height.
  const ratios = slide.image_settings.fit === 'natural' ? naturalRatios(slide) : null;
  const natural = Boolean(ratios);
  const innerStyle = {
    backgroundColor: slide.image_settings.background,
    ...(natural ? { '--ar-slide': ratios.slide, '--ar-img': ratios.image, '--ar-mobile': ratios.mobile } : {}),
  };
  return (
    <div
      className={`hc-slide${selected ? ' is-selected' : ''}`}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}${slide.heading ? `: ${slide.heading}` : ''}`}
      inert={!selected || undefined}
    >
      <div className={`hc-slide-inner layout-${slide.layout_type} fit-${natural ? 'natural' : slide.image_settings.fit}${slide.mobile_image ? ' has-mobile-image' : ''}`} style={innerStyle}>
        <SlideMedia key={`${slide.desktop_image?.url}|${slide.mobile_image?.url}`} slide={slide} device={device} eager={index === 0} load={load} />
        {showText && !split && o.panel === 'gradient' && o.panel_opacity > 0 && (
          <div className="hc-scrim" aria-hidden="true" style={{ '--scrim-d': scrim(o.desktop, o.panel_color, o.panel_opacity), '--scrim-m': scrim(o.mobile, o.panel_color, o.panel_opacity) }} />
        )}
        {showText && (
          <div className="hc-overlay" style={overlayVars}>
            <div className={`hc-copy${o.panel === 'card' ? ' is-card' : ''}`} style={card}>
              {v.heading && slide.heading && <Heading className="hc-text hc-heading" style={textStyle(slide.heading_style)}>{slide.heading}</Heading>}
              {v.subtitle && slide.subtitle && <p className="hc-text hc-subtitle" style={textStyle(slide.subtitle_style)}>{slide.subtitle}</p>}
              {v.description && slide.description && <p className="hc-text hc-description" style={textStyle(slide.description_style)}>{slide.description}</p>}
              {hasCta && (
                <div className="hc-ctas">
                  <Cta cta={slide.primary_cta} />
                  <Cta cta={slide.secondary_cta} secondary />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Parallax depth for the "slide" transition (Embla's parallax example, on the 8.x API). Only the
// image layer moves; text stays put. Slides are full width, so the strip a shifted image leaves
// behind is always off-screen, and every image is back at rest (uncropped) once a slide settles.
const TWEEN_FACTOR_BASE = 0.2;

function useParallax(emblaApi, enabled) {
  useEffect(() => {
    if (!emblaApi || !enabled) return undefined;
    let layers = [];
    let factor = 0;
    const measure = () => {
      layers = emblaApi.slideNodes().map((n) => n.querySelector('.hc-media-layer'));
      factor = TWEEN_FACTOR_BASE * emblaApi.scrollSnapList().length;
    };
    const tween = (api, event) => {
      const engine = api.internalEngine();
      const progress = api.scrollProgress();
      const inView = api.slidesInView();
      api.scrollSnapList().forEach((snap, snapIndex) => {
        let diff = snap - progress;
        engine.slideRegistry[snapIndex].forEach((slideIndex) => {
          if (event === 'scroll' && !inView.includes(slideIndex)) return;
          if (engine.options.loop) {
            engine.slideLooper.loopPoints.forEach((point) => {
              const target = point.target();
              if (slideIndex !== point.index || target === 0) return;
              if (Math.sign(target) === -1) diff = snap - (1 + progress);
              if (Math.sign(target) === 1) diff = snap + (1 - progress);
            });
          }
          const layer = layers[slideIndex];
          if (layer) layer.style.transform = `translateX(${diff * -factor * 100}%)`;
        });
      });
    };
    const reInit = (api) => {
      measure();
      tween(api);
    };
    reInit(emblaApi);
    emblaApi.on('reInit', reInit).on('scroll', tween).on('slideFocus', tween);
    return () => {
      emblaApi.off('reInit', reInit).off('scroll', tween).off('slideFocus', tween);
      layers.forEach((l) => l?.style.removeProperty('transform'));
    };
  }, [emblaApi, enabled]);
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * `slides` and `settings` come from /api/homepage-carousel (or the editor). `device` forces the
 * desktop, tablet or mobile image in a preview; on the homepage the browser chooses.
 */
export function HeroCarousel({ slides, settings, device, firstHeadingLevel = 2, label = 'Featured collections', onPreviewLink, className = '' }) {
  const count = slides.length;
  const multi = count > 1;
  const [reduced] = useState(prefersReducedMotion);
  const autoplay = settings.autoplay_enabled && multi;

  const autoplayPlugin = useMemo(() => {
    if (!autoplay) return null;
    return Autoplay({
      delay: settings.autoplay_interval || 3000,
      stopOnInteraction: false,
      stopOnMouseEnter: Boolean(settings.pause_on_hover),
      playOnInit: !reduced,
    });
  }, [autoplay, settings.autoplay_interval, settings.pause_on_hover, reduced]);

  const plugins = useMemo(() => {
    const list = [];
    if (settings.transition_type === 'fade') list.push(Fade());
    if (autoplayPlugin) list.push(autoplayPlugin);
    return list;
  }, [settings.transition_type, autoplayPlugin]);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: multi, duration: reduced ? 15 : emblaDuration(settings.transition_duration), watchDrag: multi, skipSnaps: false },
    plugins
  );
  const rootRef = useRef(null);
  const parallax = multi && settings.transition_type === 'slide' && !reduced;
  useParallax(emblaApi, parallax);
  const [selected, setSelected] = useState(0);
  const [loaded, setLoaded] = useState(() => new Set([0]));
  const [playing, setPlaying] = useState(() => !reduced);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    if (!emblaApi) return undefined;
    const onSelect = () => {
      const i = emblaApi.selectedScrollSnap();
      const n = emblaApi.slideNodes().length;
      setSelected(i);
      setLoaded((prev) => (prev.has(i) && prev.has((i + 1) % n) && prev.has((i - 1 + n) % n) ? prev : new Set([...prev, i, (i + 1) % n, (i - 1 + n) % n])));
    };
    const onDown = () => setDragging(true);
    const onUp = () => setDragging(false);
    onSelect();
    emblaApi.on('select', onSelect).on('reInit', onSelect).on('pointerDown', onDown).on('pointerUp', onUp).on('settle', onUp);
    return () => {
      emblaApi.off('select', onSelect).off('reInit', onSelect).off('pointerDown', onDown).off('pointerUp', onUp).off('settle', onUp);
    };
  }, [emblaApi]);

  // The first banner loads at once; neighbours wait for the page to finish loading so they never
  // compete with it, and later slides load only as they come up.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (document.readyState === 'complete') {
      const t = setTimeout(() => setWarm(true), 300);
      return () => clearTimeout(t);
    }
    const onLoad = () => setWarm(true);
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);
  const shouldLoad = (i) => i === 0 || (warm && loaded.has(i));

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    const onVis = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const running = autoplay && playing && inView && pageVisible && !focused && !dragging && !(settings.pause_on_hover && hovered);
  useEffect(() => {
    const ap = emblaApi?.plugins()?.autoplay;
    if (!ap) return;
    if (running) {
      if (!ap.isPlaying()) ap.play();
    } else {
      if (ap.isPlaying()) ap.stop();
    }
  }, [running, emblaApi]);

  const prev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const next = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const onKeyDown = (e) => {
    if (!multi || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    }
  };
  const onClickCapture = onPreviewLink
    ? (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        onPreviewLink(a.getAttribute('href'));
      }
    : undefined;

  if (!count) return null;
  const hD = settings.desktop_height;
  const hM = settings.mobile_height;
  return (
    <section
      ref={rootRef}
      className={`hero-carousel${settings.transition_type === 'fade' ? ' is-fade' : ''}${parallax ? ' is-parallax' : ''}${multi && (settings.show_pagination || settings.autoplay_enabled) ? ' has-controls' : ''}${className ? ` ${className}` : ''}`}
      aria-roledescription="carousel"
      aria-label={label}
      style={{ '--hc-h-d': `${hD}px`, '--hc-h-t': `${Math.round((hD + hM) / 2)}px`, '--hc-h-m': `${hM}px` }}
      onKeyDown={onKeyDown}
      onClickCapture={onClickCapture}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
    >
      <div className="hc-viewport" ref={emblaRef}>
        <div className="hc-container" aria-live={running ? 'off' : 'polite'}>
          {slides.map((s, i) => (
            <Slide key={s.id || i} slide={s} index={i} count={count} selected={i === selected} device={device} load={shouldLoad(i)} headingLevel={i === 0 ? firstHeadingLevel : 2} />
          ))}
        </div>
      </div>
      {multi && settings.show_navigation && (
        <>
          <button type="button" className="hc-arrow hc-prev" onClick={prev} aria-label="Previous slide">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" className="hc-arrow hc-next" onClick={next} aria-label="Next slide">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </>
      )}
      {multi && (settings.show_pagination || autoplay) && (
        <div className="hc-controls">
          {autoplay && (
            <button type="button" className="hc-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}>
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
              )}
            </button>
          )}
          {settings.show_pagination && (
            <div className="hc-dots">
              {slides.map((s, i) => (
                <button
                  key={s.id || i}
                  type="button"
                  className={`hc-dot${i === selected ? ' is-selected' : ''}`}
                  onClick={() => emblaApi?.scrollTo(i)}
                  aria-label={`Show slide ${i + 1}${s.heading ? `: ${s.heading}` : ''}`}
                  aria-current={i === selected ? 'true' : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
