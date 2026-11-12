import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { EmptyState, ErrorState, LoadingState } from '../components/Status';
import { cachedGet, formatINR } from '../lib/api';
import { usePageSeo } from '../lib/usePageSeo';
import { itemListSchema } from '../lib/schema';
import { absoluteUrl } from '../site.config.js';
import { categoryIntro } from '../content/categories';
import { useStore } from '../context/StoreContext';
import { saveRecent } from '../lib/recentSearches';
import { NotFound } from './NotFound';

const PAGE_SIZE = 24;
// Multi-value filters, repeated in the URL (?size=S&size=M), and the facet each one lists.
const LIST_FILTERS = [
  ['size', 'Size', 'sizes'],
  ['colour', 'Colour', 'colours'],
  ['occasion', 'Occasion', 'occasions'],
];
const SORT_LABELS = { relevance: 'Best match', featured: 'Featured', newest: 'Newest', price_asc: 'Price, low to high', price_desc: 'Price, high to low', name: 'Name, A to Z' };
const isRupees = (v) => /^\d{1,8}$/.test(v);

/** Min/max price in whole rupees; the placeholders are the lowest and highest prices on offer. */
const PriceFilter = ({ min, max, range, onApply }) => {
  const [value, setValue] = useState({ min, max });
  const field = (key, label) => (
    <label>
      <span className="visually-hidden">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={8}
        value={value[key]}
        onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value.replace(/\D/g, '') }))}
        placeholder={range ? String(range[key]) : key === 'min' ? 'Min' : 'Max'}
      />
    </label>
  );
  return (
    <form
      className="filter-group filter-price"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(value.min, value.max);
      }}
    >
      <fieldset>
        <legend className="eyebrow">Price (₹)</legend>
        <div className="filter-price-row">
          {field('min', 'Minimum price in rupees')}
          <span aria-hidden="true">–</span>
          {field('max', 'Maximum price in rupees')}
          <button type="submit" className="filter-apply">Apply</button>
        </div>
      </fieldset>
    </form>
  );
};

export const Catalogue = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = (params.category || searchParams.get('category') || '').toLowerCase();
  const q = searchParams.get('q') || '';
  const defaultSort = q ? 'relevance' : 'featured';
  const sortParam = searchParams.get('sort');
  const sort = sortParam && SORT_LABELS[sortParam] && !(sortParam === 'relevance' && !q) ? sortParam : defaultSort;
  const inStock = searchParams.get('in_stock') === 'true';
  const season = searchParams.get('colour_season') || '';
  const priceMin = isRupees(searchParams.get('price_min') || '') ? searchParams.get('price_min') : '';
  const priceMax = isRupees(searchParams.get('price_max') || '') ? searchParams.get('price_max') : '';
  const selected = useMemo(() => Object.fromEntries(LIST_FILTERS.map(([key]) => [key, searchParams.getAll(key).filter(Boolean)])), [searchParams]);
  const { colourProfile } = useStore();
  const mySeason = colourProfile?.season || '';
  const [query, setQuery] = useState(q);
  // Keep the search box in step with the URL (category links and Back/Forward clear or restore it).
  useEffect(() => setQuery(q), [q]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ products: [], total: 0, categories: [], facets: null, corrected: null, page: 1, loading: true, error: null, loadingMore: false });

  // Legacy ?category= links move to the clean URL.
  useEffect(() => {
    if (!params.category && searchParams.get('category')) {
      const next = new URLSearchParams(searchParams);
      next.delete('category');
      navigate(`/catalogue/${encodeURIComponent(category)}${next.toString() ? `?${next}` : ''}`, { replace: true });
    }
  }, [params.category, searchParams, category, navigate]);

  const current = useMemo(() => state.categories.find((c) => c.slug === category), [state.categories, category]);
  const heading = current?.name ? (q ? `${current.name}: “${q}”` : current.name) : q ? `Results for “${q}”` : 'Shop all pieces';
  const intro = current ? categoryIntro(current.slug, current.name) : 'Everything currently in the studio. Most pieces are one-of-one — once a size sells, it’s gone.';
  const path = category ? `/catalogue/${category}` : '/catalogue';
  const filterCount = LIST_FILTERS.reduce((n, [key]) => n + selected[key].length, 0) + (priceMin || priceMax ? 1 : 0) + (inStock ? 1 : 0) + (season ? 1 : 0);

  usePageSeo({
    title: current ? `${current.name} | Vishrea Studio` : undefined,
    description: current ? intro : undefined,
    canonical: path,
    noIndex: Boolean(q) || filterCount > 0 || (category && !state.loading && !current),
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Shop', url: '/catalogue' }, ...(current ? [{ name: current.name, url: path }] : [])],
    schema: state.products.length ? itemListSchema(absoluteUrl(path), state.products) : null,
    // An unknown category renders <NotFound />, which sets its own title.
    ready: !state.loading && !(category && state.categories.length && !current),
  });

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), sort });
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    if (inStock) p.set('in_stock', 'true');
    if (season) p.set('colour_season', season);
    for (const [key] of LIST_FILTERS) for (const v of selected[key]) p.append(key, v);
    if (priceMin) p.set('price_min', priceMin);
    if (priceMax) p.set('price_max', priceMax);
    return p.toString();
  }, [sort, category, q, inStock, season, selected, priceMin, priceMax]);
  const activeQuery = useRef(apiQuery);
  activeQuery.current = apiQuery;

  // Matches the API's public Cache-Control; a manual retry always goes to the network.
  const fetchPage = (page, { fresh = false } = {}) => cachedGet(`/api/catalogue?${apiQuery}&page=${page}`, { maxAge: fresh ? 0 : 30_000 });

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchPage(1, { fresh: reloadKey > 0 })
      .then((d) => current && setState({ products: d.products, total: d.total, categories: d.categories || [], facets: d.facets || null, corrected: d.corrected_query || null, page: 1, loading: false, error: null, loadingMore: false }))
      .catch((error) => current && setState((s) => ({ ...s, loading: false, error })));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiQuery, reloadKey]);

  const loadMore = async () => {
    if (state.loadingMore) return;
    const requested = apiQuery;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const d = await fetchPage(state.page + 1);
      // A filter changed while this page was loading: the new first page replaces the list instead.
      if (activeQuery.current !== requested) return;
      setState((s) => ({ ...s, products: [...s.products, ...d.products], page: s.page + 1, loadingMore: false }));
    } catch (error) {
      if (activeQuery.current === requested) setState((s) => ({ ...s, loadingMore: false, error }));
    }
  };

  const update = (change) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    next.delete('page');
    setSearchParams(next);
  };
  const setParam = (key, value) =>
    update((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  const toggleValue = (key, value) =>
    update((next) => {
      const values = next.getAll(key);
      next.delete(key);
      const on = values.some((v) => v.toLowerCase() === value.toLowerCase());
      for (const v of on ? values.filter((x) => x.toLowerCase() !== value.toLowerCase()) : [...values, value]) next.append(key, v);
    });
  const clearFilters = () =>
    update((next) => {
      for (const key of ['size', 'colour', 'occasion', 'price_min', 'price_max', 'in_stock', 'colour_season']) next.delete(key);
    });
  const applyPrice = (min, max) =>
    update((next) => {
      for (const [key, value] of [['price_min', min], ['price_max', max]]) {
        if (isRupees(value)) next.set(key, value);
        else next.delete(key);
      }
    });

  const facetValues = (key, facet) => {
    const available = state.facets?.[facet] || [];
    // Keep a value from the URL visible (and removable) even if nothing currently carries it.
    const extra = selected[key].filter((v) => !available.some((a) => a.toLowerCase() === v.toLowerCase()));
    return [...available, ...extra];
  };
  const isSelected = (key, value) => selected[key].some((v) => v.toLowerCase() === value.toLowerCase());

  const activeChips = [
    ...LIST_FILTERS.flatMap(([key, label]) => selected[key].map((v) => ({ id: `${key}:${v}`, label: `${label}: ${v}`, remove: () => toggleValue(key, v) }))),
    ...(priceMin || priceMax
      ? [{ id: 'price', label: priceMin && priceMax ? `${formatINR(priceMin)} – ${formatINR(priceMax)}` : priceMin ? `From ${formatINR(priceMin)}` : `Up to ${formatINR(priceMax)}`, remove: () => update((n) => { n.delete('price_min'); n.delete('price_max'); }) }]
      : []),
    ...(inStock ? [{ id: 'in_stock', label: 'In stock', remove: () => setParam('in_stock', '') }] : []),
    ...(season ? [{ id: 'season', label: `In ${season}`, remove: () => setParam('colour_season', '') }] : []),
  ];

  if (category && !state.loading && state.categories.length && !current) return <NotFound />;

  const listFilters = filterCount - (inStock ? 1 : 0) - (season ? 1 : 0);
  const emptyTitle = listFilters > 0 ? 'No pieces match these filters' : q ? `Nothing matches “${q}”` : season ? `No pieces tagged ${season} right now` : inStock ? 'Nothing in stock here right now' : 'Nothing here yet';
  const emptyHint = listFilters > 0 ? 'Remove a filter, or clear them all to see more pieces.' : q ? 'Check the spelling, try a shorter word or a colour, or browse a category.' : 'New pieces arrive most weeks.';

  return (
    <div>
      <Header />
      <main id="main-content">
        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          {current ? <Link to="/catalogue">Shop</Link> : <span aria-current="page">Shop</span>}
          {current && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{current.name}</span>
            </>
          )}
        </nav>
        <section className="catalogue-hero">
          <div>
            <p className="eyebrow">{current ? 'The Vishrea edit' : 'Vishrea Studio'}</p>
            <h1>{heading}</h1>
            <p>{intro}</p>
          </div>
        </section>

        <section className="catalogue-wrap" aria-label="Products">
          <div className="catalogue-toolbar">
            <form
              role="search"
              className="catalogue-search"
              onSubmit={(e) => {
                e.preventDefault();
                const value = query.replace(/\s+/g, ' ').trim();
                if (value) saveRecent(value);
                update((next) => {
                  if (value) next.set('q', value);
                  else next.delete('q');
                  if (next.get('sort') === 'relevance' && !value) next.delete('sort');
                });
              }}
            >
              <label htmlFor="catalogue-search" className="visually-hidden">Search pieces</label>
              <input id="catalogue-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pieces, colours, categories" maxLength={80} enterKeyHint="search" />
            </form>
            <div className="toolbar-actions">
              <span id="resultCount" aria-live="polite">{state.loading ? '' : `${state.total} ${state.total === 1 ? 'piece' : 'pieces'}`}</span>
              <label className="toolbar-check">
                <input type="checkbox" checked={inStock} onChange={(e) => setParam('in_stock', e.target.checked ? 'true' : '')} /> In stock
              </label>
              {(mySeason || season) && (
                <label className="toolbar-check" title={mySeason ? `Pieces tagged ${mySeason}` : undefined}>
                  <input type="checkbox" checked={Boolean(season)} onChange={(e) => setParam('colour_season', e.target.checked ? mySeason || season : '')} /> {season ? `In ${season}` : 'In my colours'}
                </label>
              )}
              <label htmlFor="sort" className="visually-hidden">Sort by</label>
              <select value={sort} onChange={(e) => setParam('sort', e.target.value === defaultSort ? '' : e.target.value)} id="sort">
                {Object.entries(SORT_LABELS)
                  .filter(([value]) => value !== 'relevance' || q)
                  .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </select>
              <button id="filterToggle" type="button" aria-expanded={filterOpen} aria-controls="filter-panel" onClick={() => setFilterOpen(!filterOpen)}>
                Filters{filterCount ? ` (${filterCount})` : ''}
              </button>
            </div>
          </div>

          <div className="catalogue-layout">
            <aside id="filter-panel" className={`filter-panel ${filterOpen ? 'mobile-open' : ''}`} aria-label="Filters">
              <p className="eyebrow">Categories</p>
              <div className="category-links">
                <Link className={!category ? 'active' : ''} to={q ? `/catalogue?q=${encodeURIComponent(q)}` : '/catalogue'} aria-current={!category ? 'page' : undefined}>All pieces</Link>
                {state.categories.map((c) => (
                  <Link key={c.id} className={category === c.slug ? 'active' : ''} to={`/catalogue/${c.slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`} aria-current={category === c.slug ? 'page' : undefined}>
                    {c.name}
                  </Link>
                ))}
              </div>

              {LIST_FILTERS.map(([key, label, facet]) => {
                const values = facetValues(key, facet);
                if (!values.length) return null;
                return (
                  <fieldset key={key} className="filter-group">
                    <legend className="eyebrow">{label}</legend>
                    <div className="filter-chips">
                      {values.map((v) => (
                        <button key={v} type="button" className={`filter-chip${isSelected(key, v) ? ' is-on' : ''}`} aria-pressed={isSelected(key, v)} onClick={() => toggleValue(key, v)}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}

              {(state.facets?.price || priceMin || priceMax) && (
                <PriceFilter key={`${priceMin}-${priceMax}`} min={priceMin} max={priceMax} range={state.facets?.price} onApply={applyPrice} />
              )}

              {filterCount > 0 && (
                <button type="button" className="filter-clear" onClick={clearFilters}>
                  Clear all filters
                </button>
              )}
            </aside>

            <div>
              {state.corrected && q && !state.loading && (
                <p className="search-correction" role="status">
                  No exact matches for “{q}”. Showing results for “{state.corrected}”.
                </p>
              )}
              {activeChips.length > 0 && (
                <div className="active-filters" aria-label="Active filters" role="group">
                  {activeChips.map((chip) => (
                    <button key={chip.id} type="button" className="active-filter" onClick={chip.remove}>
                      {chip.label} <span aria-hidden="true">×</span>
                      <span className="visually-hidden">, remove filter</span>
                    </button>
                  ))}
                  <button type="button" className="filter-clear" onClick={clearFilters}>Clear all</button>
                </div>
              )}
              {state.loading ? (
                <LoadingState label={q ? 'Searching…' : 'Loading pieces…'} />
              ) : state.error && !state.products.length ? (
                <ErrorState error={state.error} onRetry={() => setReloadKey((k) => k + 1)} title={q ? 'We couldn’t run that search' : 'We couldn’t load the pieces'} />
              ) : !state.products.length ? (
                <EmptyState
                  title={emptyTitle}
                  action={
                    <div className="empty-actions">
                      {filterCount > 0 && (
                        <button type="button" className="button button-outline" onClick={clearFilters}>
                          Clear filters
                        </button>
                      )}
                      <Link className="button button-dark" to="/catalogue">See all pieces</Link>
                    </div>
                  }
                >
                  {emptyHint}
                </EmptyState>
              ) : (
                <>
                  <div className="catalogue-grid" id="catalogueGrid">
                    {state.products.map((p, i) => (
                      <ProductCard key={p.id} product={p} className="catalogue-card" showAvailability eager={i < 4} />
                    ))}
                  </div>
                  {state.error && (
                    <p className="inline-message error" role="alert">
                      {state.error.message}
                    </p>
                  )}
                  {state.products.length < state.total && (
                    <div className="load-more">
                      <button type="button" className="button button-outline" onClick={loadMore} disabled={state.loadingMore}>
                        {state.loadingMore ? 'Loading…' : `Show more (${state.total - state.products.length})`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};
