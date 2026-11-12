import React, { useState, useEffect } from 'react';
import { useSearchParams, useParams, Link, Navigate } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { LoadingState } from '../components/Status';
import { usePageSeo } from '../lib/usePageSeo';
import { LEGAL_PAGES } from '../lib/pages';
import { api, isAbort } from '../lib/api';
import { NotFound } from './NotFound';

export const Legal = () => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const slug = params.slug || searchParams.get('slug') || 'privacy';
  const [state, setState] = useState({ page: null, loading: true, error: false });
  const known = LEGAL_PAGES[slug];

  usePageSeo({
    title: `${state.page?.title || known?.title || 'Policies'} | Vishrea Studio`,
    description: known?.description,
    canonical: `/legal/${slug}`,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: state.page?.title || known?.title || 'Policies', url: `/legal/${slug}` }],
    // An unknown policy renders <NotFound />, which sets its own title.
    ready: !state.loading && Boolean(state.page || known),
  });

  useEffect(() => {
    const c = new AbortController();
    setState({ page: null, loading: true, error: false });
    api('/api/legal?slug=' + encodeURIComponent(slug), { signal: c.signal })
      .then((d) => setState({ page: d?.page || null, loading: false, error: false }))
      .catch((err) => !isAbort(err) && setState({ page: null, loading: false, error: true }));
    return () => c.abort();
  }, [slug]);

  if (!params.slug) return <Navigate to={`/legal/${slug}`} replace />;
  if (!state.loading && !state.error && !state.page && !known) return <NotFound />;

  const others = Object.entries(LEGAL_PAGES).filter(([s]) => s !== slug);
  return (
    <div>
      <Header />
      <main id="main-content" className="prose-page">
        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{state.page?.title || known?.title || 'Policies'}</span>
        </nav>
        <h1>{state.page?.title || known?.title || 'Policies'}</h1>
        {state.page?.updated_at && <p className="prose-meta">Last updated {new Date(state.page.updated_at).toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>}
        {state.loading ? (
          <LoadingState minHeight={160} />
        ) : state.error ? (
          <p role="alert">This policy could not be loaded. Please check your connection and try again.</p>
        ) : (
          <article className="prose-body">{state.page?.body || known?.body || 'This policy is being finalised. For any question in the meantime, message us on WhatsApp.'}</article>
        )}
        <p className="prose-related">
          Also see: {others.map(([s, p], i) => (
            <React.Fragment key={s}>
              {i > 0 && ' · '}
              <Link to={`/legal/${s}`}>{p.title}</Link>
            </React.Fragment>
          ))} · <Link to="/contact">Help &amp; contact</Link>
        </p>
      </main>
      <Footer />
    </div>
  );
};
