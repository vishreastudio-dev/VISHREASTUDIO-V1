import React, { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api, cachedGet, isAbort } from '../lib/api';
import { imageFor, srcSetFor } from '../lib/imageFor';
import { clearRecent, readRecent, saveRecent } from '../lib/recentSearches';
import { priceLabel } from './ProductCard';

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 220;
const CACHE_MS = 60_000;

// Suggestions already fetched this session, so retyping or deleting back to a query is instant.
const fetched = new Map();
const remember = (key, data) => {
  fetched.delete(key);
  fetched.set(key, { at: Date.now(), data });
  if (fetched.size > 40) fetched.delete(fetched.keys().next().value);
};
const recall = (key) => {
  const hit = fetched.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.data : null;
};

const normalise = (q) => q.replace(/\s+/g, ' ').trim().toLowerCase();
const catalogueSearchUrl = (q) => (q ? `/catalogue?q=${encodeURIComponent(q)}` : '/catalogue');
const pieces = (n) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** `text` with the query words wrapped in <mark>. */
function Highlight({ text, words }) {
  const pattern = words.filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!pattern.length) return text;
  const parts = text.split(new RegExp(`(${pattern.join('|')})`, 'ig'));
  return parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

const SearchIcon = () => (
  <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export function SearchOverlay({ onClose }) {
  const navigate = useNavigate();
  const uid = useId();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [query, setQuery] = useState('');
  // Results are stored with the query they answer; anything else is stale.
  const [result, setResult] = useState({ for: '', data: null, error: null });
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState(readRecent);
  const [browse, setBrowse] = useState(null);

  const term = normalise(query);
  const searching = term.length >= MIN_LENGTH;
  const current = searching && result.for === term ? result : null;
  const loading = searching && !current;
  const data = searching ? current?.data || result.data : null;
  const error = current?.error || null;
  const words = (data?.corrected_query || term).split(' ');

  // While open, the page behind is inert (no focus, hidden from screen readers) and does not scroll.
  useEffect(() => {
    const opener = document.activeElement;
    const app = document.getElementById('root');
    const overflow = document.body.style.overflow;
    app?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      app?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    cachedGet('/api/search?q=', { maxAge: 300_000 })
      .then((d) => live && setBrowse(d.browse || []))
      .catch(() => live && setBrowse([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!searching) return undefined;
    const controller = new AbortController();
    const cached = recall(term);
    const timer = setTimeout(
      () => {
        if (cached) return setResult({ for: term, data: cached, error: null });
        api(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal, timeoutMs: 10_000 })
          .then((d) => {
            remember(term, d);
            setResult({ for: term, data: d, error: null });
          })
          .catch((err) => {
            if (!isAbort(err) && !controller.signal.aborted) setResult((r) => ({ for: term, data: r.data, error: err }));
          });
      },
      cached ? 0 : DEBOUNCE_MS
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, searching, retry]);

  const typed = query.replace(/\s+/g, ' ').trim();
  const options = useMemo(() => {
    const opt = (kind, key, rest) => ({ kind, id: `${uid}-${kind}-${key}`, ...rest });
    const browseOptions = (browse || []).map((c) => opt('category', c.slug, { href: `/catalogue/${c.slug}`, label: c.name, meta: pieces(c.count) }));
    if (!searching) return [...recent.map((r, i) => opt('recent', i, { href: catalogueSearchUrl(r), label: r, query: r })), ...browseOptions];
    if (!data || error) return [];
    if (!data.total) return loading ? [] : browseOptions;
    const shownQuery = data.corrected_query || typed;
    return [
      ...data.categories.map((c) =>
        opt('category', c.slug, {
          href: c.name_match ? `/catalogue/${c.slug}` : `/catalogue/${c.slug}?q=${encodeURIComponent(shownQuery)}`,
          label: c.name_match ? c.name : `“${shownQuery}” in ${c.name}`,
          meta: pieces(c.count),
        })
      ),
      ...data.products.map((p) => opt('product', p.id, { href: `/product/${encodeURIComponent(p.slug || p.id)}`, label: p.name, product: p })),
      opt('all', 'results', { href: catalogueSearchUrl(typed), label: `See all ${pieces(data.total)}` }),
    ];
  }, [uid, browse, recent, searching, data, error, loading, typed]);
  const activeIndex = active < options.length ? active : -1;

  const go = (href, saved) => {
    if (saved && saved.length >= MIN_LENGTH) saveRecent(saved);
    onClose();
    navigate(href);
  };
  const select = (option) => go(option.href, option.query ?? typed);

  const submit = (e) => {
    e.preventDefault();
    if (activeIndex >= 0) return select(options[activeIndex]);
    go(catalogueSearchUrl(typed), typed);
  };

  const onInputKey = (e) => {
    if (e.key === 'Enter') {
      // Not while an input method is composing a character.
      if (!e.nativeEvent.isComposing) submit(e);
      return;
    }
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(activeIndex + 1 >= options.length ? 0 : activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
    } else if (e.key === 'Home' && activeIndex >= 0) {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End' && activeIndex >= 0) {
      e.preventDefault();
      move(options.length - 1);
    }
  };

  const move = (next) => {
    setActive(next);
    if (next >= 0) document.getElementById(options[next].id)?.scrollIntoView({ block: 'nearest' });
  };

  // Escape closes; Tab stays inside the dialog.
  const onPanelKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...panelRef.current.querySelectorAll('input, button:not([disabled]), a[href]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const clear = () => {
    setQuery('');
    setActive(-1);
    inputRef.current?.focus();
  };

  const optionProps = (option, index) => ({
    id: option.id,
    role: 'option',
    tabIndex: -1,
    'aria-selected': index === activeIndex,
    className: `search-option search-option-${option.kind}${index === activeIndex ? ' is-active' : ''}`,
    to: option.href,
    onMouseMove: () => activeIndex !== index && setActive(index),
    onClick: (e) => {
      // Let modified clicks open a new tab as links normally do.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      select(option);
    },
  });

  const group = (kind) => options.map((o, i) => [o, i]).filter(([o]) => o.kind === kind);
  const recentGroup = group('recent');
  const categoryGroup = group('category');
  const productGroup = group('product');
  const allOption = group('all')[0];

  const announcement = !searching
    ? ''
    : error
      ? 'Search is unavailable right now.'
      : loading && !data
        ? 'Searching…'
        : data && !loading
          ? data.total
            ? `${pieces(data.total)} found${data.corrected_query ? `, showing results for ${data.corrected_query}` : ''}. Use the up and down arrow keys to browse suggestions.`
            : `No pieces match ${typed}.`
          : '';

  const categoryList = (title) =>
    categoryGroup.length > 0 && (
      <div role="group" aria-label={title} className="search-group">
        <p className="search-group-title" aria-hidden="true">{title}</p>
        <div className="search-chips">
          {categoryGroup.map(([o, i]) => (
            <Link key={o.id} {...optionProps(o, i)}>
              <span className="search-option-label">{searching && data?.total ? <Highlight text={o.label} words={words} /> : o.label}</span>
              <span className="search-option-meta">{o.meta}</span>
            </Link>
          ))}
        </div>
      </div>
    );

  return createPortal(
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} ref={panelRef} onKeyDown={onPanelKey}>
        <h2 id={`${uid}-title`} className="visually-hidden">Search Vishrea Studio</h2>
        <form className="search-bar" role="search" onSubmit={submit}>
          <SearchIcon />
          <label htmlFor={`${uid}-input`} className="visually-hidden">Search pieces, colours and categories</label>
          <input
            ref={inputRef}
            id={`${uid}-input`}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={`${uid}-list`}
            aria-activedescendant={activeIndex >= 0 ? options[activeIndex].id : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
            }}
            onKeyDown={onInputKey}
            placeholder="Search dresses, colours, categories"
            maxLength={80}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query && (
            <button type="button" className="search-clear" onClick={clear}>
              Clear<span className="visually-hidden"> search</span>
            </button>
          )}
          <button type="button" className="search-close" onClick={onClose} aria-label="Close search">
            <span aria-hidden="true">✕</span>
          </button>
        </form>
        <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

        <div className="search-body" aria-busy={loading}>
          {!searching && recent.length > 0 && (
            <div className="search-tools">
              <button
                type="button"
                className="search-text-button"
                onClick={() => {
                  setRecent(clearRecent());
                  setActive(-1);
                  inputRef.current?.focus();
                }}
              >
                Clear recent searches
              </button>
            </div>
          )}
          {searching && data?.corrected_query && !error && (
            <p className="search-note">
              No exact matches for “{typed}”. Showing results for “{data.corrected_query}”.
            </p>
          )}
          {searching && error && (
            <div className="search-message" role="alert">
              <strong>Search is unavailable right now.</strong>
              <p>{error.message}</p>
              <button
                type="button"
                className="button button-outline"
                onClick={() => {
                  setResult((r) => ({ ...r, for: '' }));
                  setRetry((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          )}
          {searching && loading && !data && !error && <p className="search-status">Searching…</p>}
          {searching && data && !data.total && !loading && !error && (
            <div className="search-message">
              <strong>No pieces match “{typed}”.</strong>
              <p>Check the spelling, try a shorter word or a colour, or browse a category.</p>
            </div>
          )}

          <div id={`${uid}-list`} role="listbox" aria-label="Search suggestions" className={`search-results${loading && data ? ' is-stale' : ''}`}>
            {recentGroup.length > 0 && (
              <div role="group" aria-label="Recent searches" className="search-group">
                <p className="search-group-title" aria-hidden="true">Recent searches</p>
                {recentGroup.map(([o, i]) => (
                  <Link key={o.id} {...optionProps(o, i)}>
                    <span className="search-option-label">{o.label}</span>
                  </Link>
                ))}
              </div>
            )}
            {!searching || !data?.total ? (
              categoryList(searching ? 'Browse a category' : 'Shop by category')
            ) : (
              <div className="search-columns">
                {categoryList('Categories')}
                {productGroup.length > 0 && (
                  <div role="group" aria-label="Pieces" className="search-group search-products">
                    <p className="search-group-title" aria-hidden="true">Pieces</p>
                    {productGroup.map(([o, i]) => (
                      <Link key={o.id} {...optionProps(o, i)}>
                        <img src={imageFor(o.product)} srcSet={srcSetFor(imageFor(o.product), [160, 320])} sizes="64px" alt="" width="64" height="80" loading="lazy" decoding="async" />
                        <span className="search-product-text">
                          <span className="search-product-name"><Highlight text={o.label} words={words} /></span>
                          <span className="search-option-meta">
                            {[o.product.category, priceLabel(o.product), o.product.available ? null : 'Sold out'].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            {allOption && (
              <Link key={allOption[0].id} {...optionProps(allOption[0], allOption[1])}>
                {allOption[0].label} for “{typed}” <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
