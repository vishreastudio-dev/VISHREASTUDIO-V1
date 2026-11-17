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
import {
  ColourSwatchFilter,
  SizeFilter,
  OccasionFilter,
  PriceRangeFilter,
  CategoryFilter,
  AvailabilityFilter,
  ActiveFilterSummary,
  MobileFilterDrawer,
} from '../components/CatalogueFilters';

const PAGE_SIZE = 24;
const LIST_FILTERS = [
  ['size', 'Size', 'sizes'],
  ['colour', 'Colour', 'colours'],
  ['occasion', 'Occasion', 'occasions'],
];
const SORT_LABELS = {
  relevance: 'Best match',
  featured: 'Featured',
  newest: 'Newest',
  price_asc: 'Price, low to high',
  price_desc: 'Price, high to low',
  name: 'Name, A to Z',
};
const isRupees = (v) => /^\d{1,8}$/.test(v);

export const Catalogue = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = (params.category || searchParams.get('category') || '').toLowerCase();
  const q = searchParams.get('q') || '';
  const defaultSort = q ? 'relevance' : 'featured';
  const sortParam = searchParams.get('sort');
  const sort = sortParam && SORT_LABELS[sortParam] && !(sortParam === 'relevance' && !q) ? sortParam : defaultSort;
  const availability = searchParams.get('availability') || (searchParams.get('in_stock') === 'true' ? 'in_stock' : searchParams.get('sold_only') === 'true' ? 'sold' : 'all');
  const inStock = availability === 'in_stock';
  const isSoldOnly = availability === 'sold';
  const season = searchParams.get('colour_season') || '';
  const priceMin = isRupees(searchParams.get('price_min') || '') ? searchParams.get('price_min') : '';
  const priceMax = isRupees(searchParams.get('price_max') || '') ? searchParams.get('price_max') : '';
  const selected = useMemo(
    () => Object.fromEntries(LIST_FILTERS.map(([key]) => [key, searchParams.getAll(key).filter(Boolean)])),
    [searchParams]
  );
  const { colourProfile, activeSizeProfile, sizeFilterEnabled, setSizeFilterEnabled } = useStore();
  const mySeason = colourProfile?.season || '';
  const [query, setQuery] = useState(q);

  useEffect(() => setQuery(q), [q]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({
    products: [],
    total: 0,
    categories: [],
    facets: null,
    corrected: null,
    page: 1,
    loading: true,
    error: null,
    loadingMore: false,
  });

  // Legacy ?category= links move to the clean URL.
  useEffect(() => {
    if (!params.category && searchParams.get('category')) {
      const next = new URLSearchParams(searchParams);
      next.delete('category');
      navigate(`/catalogue/${encodeURIComponent(category)}${next.toString() ? `?${next}` : ''}`, { replace: true });
    }
  }, [params.category, searchParams, category, navigate]);

  const current = useMemo(() => state.categories.find((c) => c.slug === category), [state.categories, category]);
  const heading = isSoldOnly
    ? 'Gone to a new home'
    : current?.name
    ? (q ? `${current.name}: “${q}”` : current.name)
    : q
    ? `Results for “${q}”`
    : 'Shop all pieces';
  const intro = isSoldOnly
    ? 'An archive gallery of beloved one-of-one pieces that have found their homes. Every piece at Vishrea is unique.'
    : current
    ? categoryIntro(current.slug, current.name)
    : 'Everything currently in the studio. Most pieces are one-of-one — once a size sells, it’s gone.';
  const path = category ? `/catalogue/${category}` : '/catalogue';
  const filterCount = LIST_FILTERS.reduce((n, [key]) => n + selected[key].length, 0) + (priceMin || priceMax ? 1 : 0) + (availability !== 'all' ? 1 : 0) + (season ? 1 : 0);

  usePageSeo({
    title: current ? `${current.name} | Vishrea Studio` : undefined,
    description: current ? intro : undefined,
    canonical: path,
    noIndex: Boolean(q) || filterCount > 0 || (category && !state.loading && !current),
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Shop', url: '/catalogue' }, ...(current ? [{ name: current.name, url: path }] : [])],
    schema: state.products.length ? itemListSchema(absoluteUrl(path), state.products) : null,
    ready: !state.loading && !(category && state.categories.length && !current),
  });

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), sort });
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    if (availability === 'sold') p.set('availability', 'sold');
    else if (inStock) p.set('in_stock', 'true');
    if (season) p.set('colour_season', season);
    for (const [key] of LIST_FILTERS) for (const v of selected[key]) p.append(key, v);
    if (priceMin) p.set('price_min', priceMin);
    if (priceMax) p.set('price_max', priceMax);
    if (activeSizeProfile) {
      p.set('profile_id', activeSizeProfile.id);
      p.set('size_filter', sizeFilterEnabled ? 'true' : 'false');
    }
    return p.toString();
  }, [sort, category, q, availability, inStock, season, selected, priceMin, priceMax, activeSizeProfile, sizeFilterEnabled]);
  const activeQuery = useRef(apiQuery);
  activeQuery.current = apiQuery;

  const fetchPage = (page, { fresh = false } = {}) => cachedGet(`/api/catalogue?${apiQuery}&page=${page}`, { maxAge: fresh ? 0 : 30_000 });

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchPage(1, { fresh: reloadKey > 0 })
      .then((d) =>
        active &&
        setState({
          products: d.products,
          total: d.total,
          categories: d.categories || [],
          facets: d.facets || null,
          corrected: d.corrected_query || null,
          page: 1,
          loading: false,
          error: null,
          loadingMore: false,
        })
      )
      .catch((error) => active && setState((s) => ({ ...s, loading: false, error })));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiQuery, reloadKey]);

  const loadMore = async () => {
    if (state.loadingMore) return;
    const requested = apiQuery;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const d = await fetchPage(state.page + 1);
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
      for (const key of ['size', 'colour', 'occasion', 'price_min', 'price_max', 'in_stock', 'availability', 'sold_only', 'colour_season']) next.delete(key);
    });
  const applyPrice = (min, max) =>
    update((next) => {
      for (const [key, value] of [
        ['price_min', min],
        ['price_max', max],
      ]) {
        if (isRupees(value)) next.set(key, value);
        else next.delete(key);
      }
    });

  const facetValues = (key, facet) => {
    const available = state.facets?.[facet] || [];
    const extra = selected[key].filter((v) => !available.some((a) => a.toLowerCase() === v.toLowerCase()));
    return [...available, ...extra];
  };

  const activeChips = [
    ...selected.colour.map((v) => ({
      id: `colour:${v}`,
      type: 'colour',
      raw: v,
      label: v,
      remove: () => toggleValue('colour', v),
    })),
    ...selected.size.map((v) => ({
      id: `size:${v}`,
      type: 'size',
      raw: v,
      label: `Size: ${v}`,
      remove: () => toggleValue('size', v),
    })),
    ...selected.occasion.map((v) => ({
      id: `occasion:${v}`,
      type: 'occasion',
      raw: v,
      label: v,
      remove: () => toggleValue('occasion', v),
    })),
    ...(priceMin || priceMax
      ? [
          {
            id: 'price',
            type: 'price',
            label:
              priceMin && priceMax
                ? `${formatINR(priceMin)} – ${formatINR(priceMax)}`
                : priceMin
                ? `From ${formatINR(priceMin)}`
                : `Up to ${formatINR(priceMax)}`,
            remove: () =>
              update((n) => {
                n.delete('price_min');
                n.delete('price_max');
              }),
          },
        ]
      : []),
    ...(isSoldOnly
      ? [
          {
            id: 'availability_sold',
            type: 'availability',
            label: 'Gone to a new home',
            remove: () =>
              update((n) => {
                n.delete('availability');
                n.delete('sold_only');
              }),
          },
        ]
      : inStock
      ? [
          {
            id: 'in_stock',
            type: 'in_stock',
            label: 'In stock only',
            remove: () =>
              update((n) => {
                n.delete('in_stock');
                n.delete('availability');
              }),
          },
        ]
      : []),
    ...(season
      ? [
          {
            id: 'season',
            type: 'season',
            label: `Season: ${season}`,
            remove: () => setParam('colour_season', ''),
          },
        ]
      : []),
  ];

  if (category && !state.loading && state.categories.length && !current) return <NotFound />;

  const listFilters = filterCount - (inStock ? 1 : 0) - (season ? 1 : 0);
  const emptyTitle = listFilters > 0 ? 'No pieces match these filters' : q ? `Nothing matches “${q}”` : season ? `No pieces tagged ${season} right now` : inStock ? 'Nothing in stock here right now' : 'Nothing here yet';
  const emptyHint = listFilters > 0 ? 'Remove a filter, or clear them all to see more pieces.' : q ? 'Check the spelling, try a shorter word or a colour, or browse a category.' : 'New pieces arrive most weeks.';

  const filterContent = (
    <>
      <CategoryFilter categories={state.categories} activeCategory={category} q={q} />
      <ColourSwatchFilter
        colours={facetValues('colour', 'colours')}
        selected={selected.colour}
        onToggle={(v) => toggleValue('colour', v)}
      />
      <SizeFilter
        sizes={facetValues('size', 'sizes')}
        selected={selected.size}
        onToggle={(v) => toggleValue('size', v)}
      />
      <OccasionFilter
        occasions={facetValues('occasion', 'occasions')}
        selected={selected.occasion}
        onToggle={(v) => toggleValue('occasion', v)}
      />
      {(state.facets?.price || priceMin || priceMax) && (
        <PriceRangeFilter
          key={`${priceMin}-${priceMax}`}
          min={priceMin}
          max={priceMax}
          range={state.facets?.price}
          onApply={applyPrice}
          onReset={() => {
            update((n) => {
              n.delete('price_min');
              n.delete('price_max');
            });
          }}
        />
      )}
      <AvailabilityFilter
        availability={availability}
        inStock={inStock}
        onSelect={(val) => {
          update((n) => {
            if (val === 'sold') {
              n.set('availability', 'sold');
              n.delete('in_stock');
            } else if (val === 'in_stock') {
              n.set('in_stock', 'true');
              n.delete('availability');
            } else {
              n.delete('in_stock');
              n.delete('availability');
            }
          });
        }}
      />
      {filterCount > 0 && (
        <button type="button" className="filter-clear" onClick={clearFilters}>
          Clear all filters
        </button>
      )}
    </>
  );

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
              <input
                id="catalogue-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pieces, colours, categories"
                maxLength={80}
                enterKeyHint="search"
              />
            </form>
            <div className="toolbar-actions">
              <span id="resultCount" aria-live="polite">
                {state.loading ? 'Updating…' : `${state.total} ${state.total === 1 ? 'piece' : 'pieces'}`}
              </span>
              <label className="toolbar-check">
                <input
                  type="checkbox"
                  checked={inStock}
                  onChange={(e) => setParam('in_stock', e.target.checked ? 'true' : '')}
                /> In stock
              </label>
              {(mySeason || season) && (
                <label className="toolbar-check" title={mySeason ? `Pieces tagged ${mySeason}` : undefined}>
                  <input
                    type="checkbox"
                    checked={Boolean(season)}
                    onChange={(e) => setParam('colour_season', e.target.checked ? mySeason || season : '')}
                  /> {season ? `In ${season}` : 'In my colours'}
                </label>
              )}
              <label htmlFor="sort" className="visually-hidden">Sort by</label>
              <div className="sort-dropdown-wrap">
                <select
                  value={sort}
                  onChange={(e) => setParam('sort', e.target.value === defaultSort ? '' : e.target.value)}
                  id="sort"
                  aria-label="Sort pieces by"
                >
                  {Object.entries(SORT_LABELS)
                    .filter(([value]) => value !== 'relevance' || q)
                    .map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                </select>
              </div>
              <button
                id="filterToggle"
                type="button"
                className="filter-toggle-btn"
                aria-expanded={filterOpen}
                aria-controls="filter-panel"
                onClick={() => setFilterOpen(true)}
              >
                <span>Filters</span>
                {filterCount > 0 && <span className="filter-badge-count">{filterCount}</span>}
              </button>
            </div>
          </div>

          <div className="catalogue-layout">
            <aside id="filter-panel" className="filter-panel" aria-label="Filters">
              {filterContent}
            </aside>

            {/* Mobile slide-in drawer */}
            <MobileFilterDrawer
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
              onClearAll={clearFilters}
              total={state.total}
              filterCount={filterCount}
            >
              {filterContent}
            </MobileFilterDrawer>

            <div className="catalogue-main">
              {state.corrected && q && !state.loading && (
                <p className="search-correction" role="status">
                  No exact matches for “{q}”. Showing results for “{state.corrected}”.
                </p>
              )}

              {activeSizeProfile && (
                <div className="catalogue-size-filter-banner">
                  <div className="catalogue-size-filter-info">
                    <span>
                      Shopping for <strong>{activeSizeProfile.name}</strong> ({category ? (activeSizeProfile.category_sizes?.[category] || activeSizeProfile.clothing_size || 'M') : activeSizeProfile.clothing_size || 'M'})
                    </span>
                    {sizeFilterEnabled ? (
                      <span style={{ fontSize: 10, color: 'var(--wine, #752238)', background: '#fbf5f6', border: '1px solid #e8d7dc', padding: '2px 7px', fontWeight: 600, letterSpacing: '0.04em' }}>
                        FILTERED BY SIZE
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#666', background: '#eee', padding: '2px 7px' }}>
                        EXPANDED CATALOGUE (ALL SIZES)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="catalogue-size-toggle-btn"
                    onClick={() => setSizeFilterEnabled(!sizeFilterEnabled)}
                  >
                    {sizeFilterEnabled ? 'View All Sizes (Expanded)' : `Filter to ${activeSizeProfile.name}’s Size`}
                  </button>
                </div>
              )}

              <ActiveFilterSummary
                chips={activeChips}
                onClearAll={clearFilters}
                total={state.total}
                loading={state.loading}
              />

              {state.loading ? (
                <LoadingState label={q ? 'Searching…' : 'Loading pieces…'} />
              ) : state.error && !state.products.length ? (
                <ErrorState error={state.error} onRetry={() => setReloadKey((k) => k + 1)} title={q ? 'We couldn’t run that search' : 'We couldn’t load the pieces'} />
              ) : !state.products.length ? (
                <EmptyState
                  title={sizeFilterEnabled && activeSizeProfile ? `No pieces currently available in size ${activeSizeProfile.clothing_size} for ${activeSizeProfile.name}` : emptyTitle}
                  action={
                    <div className="empty-actions">
                      {sizeFilterEnabled && activeSizeProfile && (
                        <button type="button" className="button button-outline" onClick={() => setSizeFilterEnabled(false)}>
                          View All Sizes (Expanded)
                        </button>
                      )}
                      {filterCount > 0 && (
                        <button type="button" className="button button-outline" onClick={clearFilters}>
                          Clear filters
                        </button>
                      )}
                      <Link className="button button-dark" to="/catalogue">See all pieces</Link>
                    </div>
                  }
                >
                  {sizeFilterEnabled && activeSizeProfile ? `Try viewing all sizes to see pieces outside ${activeSizeProfile.name}’s saved sizing, or switch to another size profile in the header.` : emptyHint}
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
