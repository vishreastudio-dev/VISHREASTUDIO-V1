import React from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { usePageSeo } from '../lib/usePageSeo';

export const NotFound = () => {
  usePageSeo({ title: 'Page not found | Vishrea Studio', noIndex: true });
  return (
    <div>
      <Header />
      <main id="main-content" className="state-page">
        <p className="eyebrow">404</p>
        <h1>This page has moved on.</h1>
        <p>The link may be outdated, or the piece has found its owner.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="button button-dark" to="/catalogue">Shop the edit</Link>
          <Link className="button button-outline" to="/">Go home</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
};
