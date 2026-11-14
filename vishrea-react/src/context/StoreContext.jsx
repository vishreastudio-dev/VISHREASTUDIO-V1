import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, cachedGet, invalidateCached, onUnauthorized } from '../lib/api';

const StoreContext = createContext(null);

const GUEST_CART_KEY = 'vishrea_guest_cart';
const COLOUR_KEY = 'vishrea_colour_profile';
const REFERRAL_KEY = 'vishrea_referral';
const REFERRAL_TTL_MS = 30 * 86_400_000;

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export const StoreProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [serverCart, setServerCart] = useState({ items: [], estimate: null, membership: null });
  const [guestCart, setGuestCart] = useState(() => {
    const saved = readJson(GUEST_CART_KEY, []);
    return Array.isArray(saved) ? saved : [];
  });
  const [cartBusy, setCartBusy] = useState(false);
  // Derived colour attributes only (never images); kept on this device.
  const [colourProfile, setColourProfileState] = useState(() => readJson(COLOUR_KEY, null));
  // Bag loads wait for an in-flight guest-bag merge, and only the newest response is applied,
  // so a fetch that started before the merge can never overwrite the merged bag.
  const mergePromise = useRef(null);
  const cartSeq = useRef(0);

  useEffect(() => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(guestCart));
  }, [guestCart]);

  const setColourProfile = useCallback((p) => {
    setColourProfileState(p);
    if (p) localStorage.setItem(COLOUR_KEY, JSON.stringify(p));
    else localStorage.removeItem(COLOUR_KEY);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const d = await cachedGet('/api/auth/session');
      setUser(d?.user || null);
      return d?.user || null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setAuthReady(true);
    }
  }, []);

  const applyCart = useCallback((d, seq) => {
    const next = {
      items: Array.isArray(d?.items) ? d.items : [],
      estimate: d?.estimate ?? null,
      membership: d?.membership ?? null,
      rewards_available: Array.isArray(d?.rewards_available) ? d.rewards_available : [],
    };
    if (seq === cartSeq.current) setServerCart(next);
    return d;
  }, []);

  const refreshCart = useCallback(async () => {
    if (mergePromise.current) await mergePromise.current;
    const seq = ++cartSeq.current;
    return applyCart(await cachedGet('/api/cart'), seq);
  }, [applyCart]);

  useEffect(() => {
    refreshSession();
    // Clean up state written by earlier client builds (fake admin user, local orders/products).
    ['vishrea_react_user', 'vishrea_react_products', 'vishrea_react_categories', 'vishrea_react_orders', 'vishrea_react_cart', 'vishrea_react_membership', 'vishrea_react_colour_profile'].forEach((k) =>
      localStorage.removeItem(k)
    );
  }, [refreshSession]);

  useEffect(() => onUnauthorized(() => setUser(null)), []);

  // Referral links (`/?ref=CODE`): validate with the server and keep the code until sign-in.
  const [referral, setReferral] = useState(() => {
    const r = readJson(REFERRAL_KEY, null);
    return r && Date.now() - r.at < REFERRAL_TTL_MS ? r : null;
  });
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (!code) return;
    api(`/api/referrals?code=${encodeURIComponent(code)}`)
      .then((d) => {
        if (!d?.valid) return;
        const r = { code: code.trim().toUpperCase(), offer: d.offer, at: Date.now() };
        localStorage.setItem(REFERRAL_KEY, JSON.stringify(r));
        setReferral(r);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || !referral?.code || referral.recorded) return;
    api('/api/referrals', { method: 'POST', body: { action: 'attribute', code: referral.code } })
      .then(() => {
        const r = { ...referral, recorded: true };
        localStorage.setItem(REFERRAL_KEY, JSON.stringify(r));
        setReferral(r);
      })
      .catch((err) => {
        // Not eligible (own code, existing member, already referred): stop retrying.
        if (err.status >= 400 && err.status < 500) {
          localStorage.removeItem(REFERRAL_KEY);
          setReferral(null);
        }
      });
  }, [user, referral]);

  // Members see early-access pieces, so responses cached for one account must not serve another.
  const userId = user?.id || null;
  const lastUserId = useRef(userId);
  useEffect(() => {
    if (lastUserId.current !== userId) invalidateCached();
    lastUserId.current = userId;
  }, [userId]);

  // After sign-in: move the guest bag into the account bag, then load it.
  useEffect(() => {
    if (!userId) {
      cartSeq.current += 1;
      setServerCart({ items: [], estimate: null, membership: null });
      return;
    }
    const pending = readJson(GUEST_CART_KEY, []);
    if (pending.length && !mergePromise.current) {
      // Clear the guest bag up front so a repeated effect run cannot merge it twice.
      localStorage.setItem(GUEST_CART_KEY, '[]');
      setGuestCart([]);
      mergePromise.current = api('/api/cart', { method: 'POST', body: { action: 'merge', items: pending.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })) } })
        .catch(() => {
          /* items that can no longer be bought are dropped by the server */
        })
        .finally(() => {
          mergePromise.current = null;
        });
    }
    refreshCart().catch(() => {});
  }, [userId, refreshCart]);

  const startLogin = useCallback((email) => api('/api/auth/start-login', { method: 'POST', body: { email } }), []);

  const verifyCode = useCallback(async (email, code) => {
    const d = await api('/api/auth/verify-code', { method: 'POST', body: { email, code } });
    setUser(d.user);
    return d;
  }, []);

  const completeProfile = useCallback(async (profileData) => {
    const res = await api('/api/account', {
      method: 'PUT',
      body: { ...profileData, profile_completed: true },
    });
    setUser((prev) => (prev ? { ...prev, name: profileData.full_name || prev.name, phone: profileData.phone || prev.phone, profile_completed: true } : prev));
    return res;
  }, []);

  const completeOnboarding = useCallback(async () => {
    await api('/api/account', {
      method: 'PUT',
      body: { onboarding_completed: true },
    }).catch(() => {});
    setUser((prev) => (prev ? { ...prev, onboarding_completed: true } : prev));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/signout', { method: 'POST', body: {} });
    } finally {
      setUser(null);
      setGuestCart([]);
    }
  }, []);

  /** Add a specific variant. `product` and `variant` are display snapshots only; prices come from the server. */
  const addToCart = useCallback(
    async ({ product, variant, quantity = 1 }) => {
      if (!variant?.id) throw new Error('Please choose a size');
      if (user) {
        setCartBusy(true);
        try {
          const d = await api('/api/cart', { method: 'POST', body: { variant_id: variant.id, quantity } });
          applyCart(d, ++cartSeq.current);
        } finally {
          setCartBusy(false);
        }
        return;
      }
      setGuestCart((prev) => {
        const existing = prev.find((x) => x.variant_id === variant.id);
        const max = product?.is_one_of_one ? 1 : Math.max(1, Math.min(10, variant.available_quantity || 1));
        if (existing) return prev.map((x) => (x.variant_id === variant.id ? { ...x, quantity: Math.min(max, x.quantity + quantity) } : x));
        return [
          ...prev,
          {
            id: `guest-${variant.id}`,
            variant_id: variant.id,
            product_id: product?.id,
            name: product?.name,
            slug: product?.slug,
            image_url: product?.image_url || product?.images?.[0] || null,
            category: product?.category || null,
            size_label: variant.size_label,
            sku: variant.sku,
            unit_price: variant.effective_price,
            is_one_of_one: Boolean(product?.is_one_of_one),
            quantity: Math.min(max, quantity),
            guest: true,
          },
        ].slice(0, 30);
      });
    },
    [user, applyCart]
  );

  const updateCartItem = useCallback(
    async (item, patch) => {
      if (item.guest) {
        setGuestCart((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
        return;
      }
      setCartBusy(true);
      try {
        const d = await api('/api/cart', { method: 'PATCH', body: { item_id: item.id, ...patch } });
        applyCart(d, ++cartSeq.current);
      } finally {
        setCartBusy(false);
      }
    },
    [applyCart]
  );

  const removeFromCart = useCallback(async (item) => {
    if (item.guest) {
      setGuestCart((prev) => prev.filter((x) => x.id !== item.id));
      return;
    }
    setCartBusy(true);
    try {
      const d = await api('/api/cart', { method: 'DELETE', body: { item_id: item.id } });
      applyCart(d, ++cartSeq.current);
    } finally {
      setCartBusy(false);
    }
  }, [applyCart]);

  const cart = (user ? serverCart?.items : guestCart);
  const bag = Array.isArray(cart) ? cart : [];
  const value = useMemo(
    () => ({
      user,
      authReady,
      isAdmin: Boolean(user?.is_admin),
      refreshSession,
      startLogin,
      verifyCode,
      signOut,
      cart: bag,
      cartCount: bag.reduce((s, i) => s + (Number(i.quantity) || 1), 0),
      cartEstimate: user ? serverCart.estimate : null,
      cartMembership: user ? serverCart.membership : null,
      cartBusy,
      refreshCart,
      addToCart,
      updateCartItem,
      removeFromCart,
      cartRewards: user ? serverCart.rewards_available || [] : [],
      colourProfile,
      setColourProfile,
      referral,
      completeProfile,
      completeOnboarding,
    }),
    [user, authReady, refreshSession, startLogin, verifyCode, completeProfile, completeOnboarding, signOut, bag, serverCart, cartBusy, refreshCart, addToCart, updateCartItem, removeFromCart, colourProfile, setColourProfile, referral]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
};
