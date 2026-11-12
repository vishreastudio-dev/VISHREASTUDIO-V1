import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RequireAuth } from './components/RequireAuth';
import { LoadingState } from './components/Status';
import { Home } from './pages/Home';
import { Catalogue } from './pages/Catalogue';
import { ProductDetail } from './pages/ProductDetail';
import { Cart } from './pages/Cart';
import { Login } from './pages/Login';
import { Legal } from './pages/Legal';
import { Contact } from './pages/Contact';
import { NotFound } from './pages/NotFound';
import { StyleAssistant } from './components/StyleAssistant';

const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const Checkout = named(() => import('./pages/Checkout'), 'Checkout');
const Membership = named(() => import('./pages/Membership'), 'Membership');
const Orders = named(() => import('./pages/Orders'), 'Orders');
const OrderDetail = named(() => import('./pages/OrderDetail'), 'OrderDetail');
const Account = named(() => import('./pages/Account'), 'Account');
const Gifting = named(() => import('./pages/Gifting'), 'Gifting');
const SkinToneAnalysis = named(() => import('./pages/SkinToneAnalysis'), 'SkinToneAnalysis');
const Admin = named(() => import('./pages/Admin'), 'Admin');
const Wardrobe = named(() => import('./pages/Wardrobe'), 'Wardrobe');
const GiftRedeem = named(() => import('./pages/GiftRedeem'), 'GiftRedeem');

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AppRoutes() {
  const location = useLocation();
  const isExcluded =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/checkout') ||
    location.pathname.startsWith('/login');

  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<LoadingState label="Loading…" minHeight="70vh" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogue" element={<Catalogue />} />
          <Route path="/catalogue/:category" element={<Catalogue />} />
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="/membership" element={<Membership />} />
          <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="/orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
          <Route path="/skin-tone" element={<SkinToneAnalysis />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/admin/:section?" element={<RequireAuth admin><Admin /></RequireAuth>} />
          <Route path="/wardrobe" element={<RequireAuth><Wardrobe /></RequireAuth>} />
          <Route path="/gifting" element={<Gifting />} />
          <Route path="/gift/redeem" element={<GiftRedeem />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:slug" element={<Legal />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      {!isExcluded && <StyleAssistant />}
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <ScrollToTop />
        <AppRoutes />
      </BrowserRouter>
    </StoreProvider>
  );
}
