import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { LoadingState } from './Status';

/** UI guard only; every protected API also enforces access on the server. */
export const RequireAuth = ({ children, admin = false }) => {
  const { user, authReady } = useStore();
  const location = useLocation();
  if (!authReady) return <LoadingState label="Checking your session…" minHeight="60vh" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && !user.is_admin) return <Navigate to="/account" replace />;
  return children;
};
