import React from 'react';

/** Catches render errors so one broken view never blanks the whole storefront. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main id="main-content" className="state-page" role="alert">
        <p className="eyebrow">VISHREA STUDIO</p>
        <h1>This page didn’t load properly.</h1>
        <p>Please refresh, or head back to the collection. Your bag is safe.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="button button-dark" onClick={() => window.location.reload()}>
            Refresh page
          </button>
          <a className="button button-outline" href="/catalogue">
            Back to the collection
          </a>
        </div>
      </main>
    );
  }
}
