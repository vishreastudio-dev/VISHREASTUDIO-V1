import React, { useId, useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { productColour } from '../lib/colourMatch';
import { formatINR } from '../lib/api';

/**
 * Checks whether a hex colour is light (luminance > 0.72)
 * so we can draw a contrasting border or checkmark.
 */
function isLightColour(hex) {
  if (!hex || typeof hex !== 'string') return false;
  const c = hex.replace('#', '');
  if (c.length !== 6 && c.length !== 3) return false;
  const num = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72;
}

/**
 * Visual Colour Swatch Filter with accessible keyboard selection,
 * hover tooltips, and high-fashion luxury aesthetics.
 */
export const ColourSwatchFilter = ({ colours = [], selected = [], onToggle }) => {
  const [hovered, setHovered] = useState(null);

  if (!colours.length) return null;

  return (
    <fieldset className="filter-group filter-colour-group">
      <div className="filter-group-header">
        <legend className="eyebrow">Colour</legend>
        <span className="filter-hint" aria-live="polite">
          {hovered || (selected.length ? `${selected.length} selected` : 'All shades')}
        </span>
      </div>
      <div className="colour-swatch-grid" role="group" aria-label="Filter pieces by colour">
        {colours.map((colourName) => {
          const match = productColour(colourName);
          const hex = match?.hex || null;
          const isSelected = selected.some((c) => c.toLowerCase() === colourName.toLowerCase());
          const isLight = isLightColour(hex);
          const isMulti = !hex || /multi|print|floral|pattern/i.test(colourName);

          return (
            <button
              key={colourName}
              type="button"
              className={`colour-swatch-item${isSelected ? ' is-selected' : ''}${isLight ? ' is-light' : ''}${isMulti ? ' is-multi' : ''}`}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`${colourName}${isSelected ? ' (selected)' : ''}`}
              title={colourName}
              onMouseEnter={() => setHovered(colourName)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(colourName)}
              onBlur={() => setHovered(null)}
              onClick={() => onToggle(colourName)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onToggle(colourName);
                }
              }}
            >
              <span
                className="colour-swatch-circle"
                style={{
                  backgroundColor: hex || '#cfc7be',
                  backgroundImage: isMulti
                    ? 'linear-gradient(135deg, #d88a97 0%, #c99a2e 33%, #2f5da8 66%, #3e7a4a 100%)'
                    : undefined,
                }}
              >
                {isSelected && (
                  <svg className="colour-check-icon" viewBox="0 0 14 14" fill="none" stroke={isLight ? '#1a1719' : '#ffffff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="2.5 7 5.5 10.5 11.5 3.5" />
                  </svg>
                )}
              </span>
              <span className="colour-swatch-tooltip" role="tooltip">{colourName}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * Dynamic Size Filter with chips for standard sizes and Free Size.
 */
export const SizeFilter = ({ sizes = [], selected = [], onToggle }) => {
  if (!sizes.length) return null;

  return (
    <fieldset className="filter-group">
      <div className="filter-group-header">
        <legend className="eyebrow">Size</legend>
        {selected.length > 0 && <span className="filter-hint">{selected.length} selected</span>}
      </div>
      <div className="filter-chips size-chips">
        {sizes.map((s) => {
          const isSelected = selected.some((v) => v.toLowerCase() === s.toLowerCase());
          return (
            <button
              key={s}
              type="button"
              className={`filter-chip size-chip${isSelected ? ' is-on' : ''}`}
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => onToggle(s)}
            >
              {s}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * Occasion Filter chips (e.g. Workwear, Evening, Brunch, Vacation, Party).
 */
export const OccasionFilter = ({ occasions = [], selected = [], onToggle }) => {
  if (!occasions.length) return null;

  return (
    <fieldset className="filter-group">
      <div className="filter-group-header">
        <legend className="eyebrow">Occasion</legend>
        {selected.length > 0 && <span className="filter-hint">{selected.length} selected</span>}
      </div>
      <div className="filter-chips occasion-chips">
        {occasions.map((occ) => {
          const isSelected = selected.some((v) => v.toLowerCase() === occ.toLowerCase());
          return (
            <button
              key={occ}
              type="button"
              className={`filter-chip occasion-chip${isSelected ? ' is-on' : ''}`}
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => onToggle(occ)}
            >
              {occ}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * Synchronized dual-handle price range slider and numeric inputs.
 */
export const PriceRangeFilter = ({ min, max, range, onApply, onReset }) => {
  const minBound = range?.min != null ? Math.floor(range.min) : 0;
  const maxBound = range?.max != null ? Math.ceil(range.max) : 25000;

  const [localMin, setLocalMin] = useState(min ? String(min) : '');
  const [localMax, setLocalMax] = useState(max ? String(max) : '');

  // Synchronize when outer URL query changes
  useEffect(() => {
    setLocalMin(min ? String(min) : '');
    setLocalMax(max ? String(max) : '');
  }, [min, max]);

  const numMin = localMin ? Math.max(minBound, Math.min(Number(localMin), maxBound)) : minBound;
  const numMax = localMax ? Math.min(maxBound, Math.max(Number(localMax), minBound)) : maxBound;

  const handleSliderMin = (e) => {
    const val = Number(e.target.value);
    const clamped = Math.min(val, numMax);
    setLocalMin(clamped <= minBound ? '' : String(clamped));
  };

  const handleSliderMax = (e) => {
    const val = Number(e.target.value);
    const clamped = Math.max(val, numMin);
    setLocalMax(clamped >= maxBound ? '' : String(clamped));
  };

  // Quick range options derived from actual bounds
  const quickRanges = useMemo(() => {
    const span = maxBound - minBound;
    if (span <= 1000) return [];
    const step = Math.round(span / 3 / 500) * 500 || 1500;
    const t1 = Math.round((minBound + step) / 500) * 500;
    const t2 = Math.round((t1 + step) / 500) * 500;
    return [
      { label: `Under ${formatINR(t1)}`, min: '', max: String(t1) },
      { label: `${formatINR(t1)} – ${formatINR(t2)}`, min: String(t1), max: String(t2) },
      { label: `Above ${formatINR(t2)}`, min: String(t2), max: '' },
    ];
  }, [minBound, maxBound]);

  const leftPercent = Math.max(0, Math.min(100, ((numMin - minBound) / Math.max(1, maxBound - minBound)) * 100));
  const rightPercent = Math.max(0, Math.min(100, ((numMax - minBound) / Math.max(1, maxBound - minBound)) * 100));

  const hasFilter = Boolean(min || max);

  const handleSubmit = (e) => {
    e.preventDefault();
    let finalMin = localMin.replace(/\D/g, '');
    let finalMax = localMax.replace(/\D/g, '');
    if (finalMin && finalMax && Number(finalMin) > Number(finalMax)) {
      const temp = finalMin;
      finalMin = finalMax;
      finalMax = temp;
      setLocalMin(finalMin);
      setLocalMax(finalMax);
    }
    onApply(finalMin, finalMax);
  };

  return (
    <form className="filter-group filter-price-advanced" onSubmit={handleSubmit}>
      <fieldset>
        <div className="filter-group-header">
          <legend className="eyebrow">Price (INR)</legend>
          <span className="filter-hint">
            {hasFilter ? `${formatINR(numMin)} – ${formatINR(numMax)}` : `${formatINR(minBound)} – ${formatINR(maxBound)}`}
          </span>
        </div>

        {/* Dual slider track */}
        <div className="dual-slider-wrap">
          <div className="dual-slider-track" />
          <div
            className="dual-slider-highlight"
            style={{
              left: `${leftPercent}%`,
              width: `${Math.max(0, rightPercent - leftPercent)}%`,
            }}
          />
          <input
            type="range"
            min={minBound}
            max={maxBound}
            step={100}
            value={numMin}
            onChange={handleSliderMin}
            className="dual-range-input dual-range-min"
            aria-label="Minimum price slider"
          />
          <input
            type="range"
            min={minBound}
            max={maxBound}
            step={100}
            value={numMax}
            onChange={handleSliderMax}
            className="dual-range-input dual-range-max"
            aria-label="Maximum price slider"
          />
        </div>

        {/* Numeric inputs */}
        <div className="price-inputs-row">
          <div className="price-input-box">
            <span className="price-currency">₹</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={String(minBound)}
              value={localMin}
              onChange={(e) => setLocalMin(e.target.value.replace(/\D/g, ''))}
              aria-label="Minimum price in rupees"
            />
          </div>
          <span className="price-separator" aria-hidden="true">–</span>
          <div className="price-input-box">
            <span className="price-currency">₹</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={String(maxBound)}
              value={localMax}
              onChange={(e) => setLocalMax(e.target.value.replace(/\D/g, ''))}
              aria-label="Maximum price in rupees"
            />
          </div>
          <button type="submit" className="price-apply-btn">Apply</button>
        </div>

        {/* Quick price range pills */}
        {quickRanges.length > 0 && (
          <div className="quick-price-ranges">
            {quickRanges.map((qr) => {
              const active = min === qr.min && max === qr.max;
              return (
                <button
                  key={qr.label}
                  type="button"
                  className={`quick-price-pill${active ? ' is-on' : ''}`}
                  onClick={() => {
                    setLocalMin(qr.min);
                    setLocalMax(qr.max);
                    onApply(qr.min, qr.max);
                  }}
                >
                  {qr.label}
                </button>
              );
            })}
          </div>
        )}

        {hasFilter && (
          <button
            type="button"
            className="filter-reset-link"
            onClick={() => {
              setLocalMin('');
              setLocalMax('');
              onReset();
            }}
          >
            Reset price range
          </button>
        )}
      </fieldset>
    </form>
  );
};

/**
 * Category Navigation List with piece counts.
 */
export const CategoryFilter = ({ categories = [], activeCategory = '', q = '' }) => {
  return (
    <div className="filter-group category-filter-group">
      <div className="filter-group-header">
        <p className="eyebrow">Categories</p>
      </div>
      <div className="category-links">
        <Link
          className={!activeCategory ? 'active' : ''}
          to={q ? `/catalogue?q=${encodeURIComponent(q)}` : '/catalogue'}
          aria-current={!activeCategory ? 'page' : undefined}
        >
          <span>All pieces</span>
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            className={activeCategory === c.slug ? 'active' : ''}
            to={`/catalogue/${c.slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`}
            aria-current={activeCategory === c.slug ? 'page' : undefined}
          >
            <span>{c.name}</span>
            {c.product_count != null && <span className="cat-count">{c.product_count}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
};

/**
 * Availability Filter (All pieces vs In Stock).
 */
export const AvailabilityFilter = ({ inStock = false, onToggle }) => {
  return (
    <fieldset className="filter-group availability-group">
      <div className="filter-group-header">
        <legend className="eyebrow">Availability</legend>
      </div>
      <div className="filter-chips availability-chips">
        <button
          type="button"
          className={`filter-chip${!inStock ? ' is-on' : ''}`}
          aria-pressed={!inStock}
          onClick={() => inStock && onToggle(false)}
        >
          All pieces
        </button>
        <button
          type="button"
          className={`filter-chip${inStock ? ' is-on' : ''}`}
          aria-pressed={inStock}
          onClick={() => !inStock && onToggle(true)}
        >
          In stock only
        </button>
      </div>
    </fieldset>
  );
};

/**
 * Active Filter Summary Bar above catalogue grid.
 */
export const ActiveFilterSummary = ({ chips = [], onClearAll, total = 0, loading = false }) => {
  if (!chips.length) return null;

  return (
    <div className="active-filters-bar" aria-label="Active filters" role="region">
      <div className="active-filters-lead">
        <span className="active-filters-count">
          {loading ? 'Updating…' : `${total} ${total === 1 ? 'piece' : 'pieces'} match`}
        </span>
        <span className="active-filters-divider" aria-hidden="true">·</span>
        <button type="button" className="filter-clear-all" onClick={onClearAll}>
          Clear all filters
        </button>
      </div>
      <div className="active-chips-list" role="group">
        {chips.map((chip) => {
          const isColour = chip.type === 'colour';
          const match = isColour ? productColour(chip.raw) : null;
          const hex = match?.hex;
          const isLight = isLightColour(hex);

          return (
            <button
              key={chip.id}
              type="button"
              className="active-filter-chip"
              onClick={chip.remove}
              title={`Remove ${chip.label}`}
            >
              {isColour && hex && (
                <span
                  className={`chip-colour-swatch${isLight ? ' is-light' : ''}`}
                  style={{ backgroundColor: hex }}
                  aria-hidden="true"
                />
              )}
              <span className="chip-text">{chip.label}</span>
              <span className="chip-remove-icon" aria-hidden="true">×</span>
              <span className="visually-hidden">, remove filter</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Mobile Filter Drawer with backdrop, scroll locking, and sticky footer.
 */
export const MobileFilterDrawer = ({
  open,
  onClose,
  onClearAll,
  total,
  filterCount,
  children,
}) => {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      const onKeyDown = (e) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', onKeyDown);
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-drawer-root" role="dialog" aria-modal="true" aria-label="Filters and Refinements">
      <div className="mobile-drawer-backdrop" onClick={onClose} />
      <div className="mobile-drawer-panel">
        <div className="mobile-drawer-header">
          <div>
            <h2 className="mobile-drawer-title">Filter & Refine</h2>
            <p className="mobile-drawer-sub">
              {total} {total === 1 ? 'piece available' : 'pieces available'}
            </p>
          </div>
          <button type="button" className="mobile-drawer-close" onClick={onClose} aria-label="Close filters">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mobile-drawer-body">
          {children}
        </div>

        <div className="mobile-drawer-footer">
          {filterCount > 0 && (
            <button type="button" className="mobile-drawer-clear" onClick={onClearAll}>
              Clear all
            </button>
          )}
          <button type="button" className="button button-dark mobile-drawer-apply" onClick={onClose}>
            {`Show ${total} ${total === 1 ? 'piece' : 'pieces'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

