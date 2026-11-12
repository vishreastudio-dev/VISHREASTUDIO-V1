import React from 'react';

export const LoadingState = ({ label = 'Loading…', minHeight = 240 }) => (
  <div className="state-block" role="status" aria-live="polite" style={{ minHeight }}>
    <span className="state-spinner" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const ErrorState = ({ error, onRetry, title = 'Something went wrong' }) => (
  <div className="state-block state-error" role="alert">
    <strong>{title}</strong>
    <p>{error?.message || 'Please try again.'}</p>
    {onRetry && (
      <button type="button" className="button button-outline" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export const EmptyState = ({ title, children, action }) => (
  <div className="state-block state-empty">
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {action}
  </div>
);

export const InlineMessage = ({ tone = 'info', id, children }) =>
  children ? (
    <p id={id} className={`inline-message ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {children}
    </p>
  ) : null;
