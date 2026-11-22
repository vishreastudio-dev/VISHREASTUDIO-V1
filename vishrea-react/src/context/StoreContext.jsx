import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, cachedGet, invalidateCached, onUnauthorized } from '../lib/api';

const StoreContext = createContext(null);

const GUEST_CART_KEY = 'vishrea_guest_cart';
const COLOUR_KEY = 'vishrea_colour_profile';
const REFERRAL_KEY = 'vishrea_referral';
const SIZE_FILTER_KEY = 'vishrea_size_filter_enabled';
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
  // Personalized Size Profiles & Active Shopping Profile
  const [sizeProfiles, setSizeProfiles] = useState([]);
  const [activeSizeProfile, setActiveSizeProfile] = useState(null);
  const [fitPreferences, setFitPreferences] = useState([]);
  const [sizeFilterEnabled, setSizeFilterEnabledState] = useState(() => readJson(SIZE_FILTER_KEY, true));
  const [myOffers, setMyOffers] = useState([]);
  const [appliedOffer, setAppliedOffer] = useState(() => readJson('vishrea_applied_offer', null));

  const setSizeFilterEnabled = useCallback((enabled) => {
    setSizeFilterEnabledState(enabled);
    localStorage.setItem(SIZE_FILTER_KEY, JSON.stringify(enabled));
  }, []);

  const refreshSizeProfiles = useCallback(async () => {
    try {
      const d = await api('/api/size-profiles');
      if (Array.isArray(d?.profiles)) {
        setSizeProfiles(d.profiles);
        setActiveSizeProfile(d.active_profile || d.profiles.find((p) => p.id === d.active_profile_id) || d.profiles[0] || null);
        if (Array.isArray(d?.fit_preferences)) {
          setFitPreferences(d.fit_preferences);
        }
        return d;
      }
    } catch {
      setSizeProfiles([]);
      setActiveSizeProfile(null);
    }
    return null;
  }, []);

  const switchActiveProfile = useCallback(async (profileId) => {
    try {
      const res = await api('/api/size-profiles', {
        method: 'PUT',
        body: { action: 'set_active', id: profileId },
      });
      if (res?.active_profile) {
        setActiveSizeProfile(res.active_profile);
      } else {
        const found = sizeProfiles.find((p) => p.id === profileId);
        if (found) setActiveSizeProfile(found);
      }
      setSizeFilterEnabled(true);
      await refreshSizeProfiles();
      return res;
    } catch (e) {
      console.error('Failed to switch active profile:', e);
      throw e;
    }
  }, [sizeProfiles, refreshSizeProfiles, setSizeFilterEnabled]);

  const saveSizeProfile = useCallback(async (data) => {
    const isEdit = Boolean(data.id);
    const res = await api('/api/size-profiles', {
      method: isEdit ? 'PUT' : 'POST',
      body: data,
    });
    await refreshSizeProfiles();
    return res;
  }, [refreshSizeProfiles]);

  const deleteSizeProfile = useCallback(async (profileId) => {
    const res = await api(`/api/size-profiles?id=${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
    });
    await refreshSizeProfiles();
    return res;
  }, [refreshSizeProfiles]);

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

  const refreshMyOffers = useCallback(async () => {
    try {
      const d = await api('/api/offers/my-offers');
      if (Array.isArray(d?.offers)) {
        setMyOffers(d.offers);
        return d.offers;
      }
    } catch {
      setMyOffers([]);
    }
    return [];
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const d = await cachedGet('/api/auth/session');
      setUser(d?.user || null);
      if (d?.user) {
        refreshSizeProfiles().catch(() => {});
        refreshMyOffers().catch(() => {});
        try {
          const raw = localStorage.getItem('vishrea_likes');
          if (raw) {
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed) ? parsed : Object.values(parsed);
            items.forEach((item) => {
              const prodId = item?.product_id || item?.id;
              if (prodId && /^[0-9a-f-]{36}$/i.test(String(prodId))) {
                api('/api/wardrobe', { method: 'POST', body: { action: 'save', product_id: prodId } }).catch(() => {});
              }
            });
          }
        } catch {}
      } else {
        setSizeProfiles([]);
        setActiveSizeProfile(null);
        setMyOffers([]);
      }
      return d?.user || null;
    } catch {
      setUser(null);
      setSizeProfiles([]);
      setActiveSizeProfile(null);
      setMyOffers([]);
      return null;
    } finally {
      setAuthReady(true);
    }
  }, [refreshSizeProfiles, refreshMyOffers]);

  const applyCart = useCallback((d, seq) => {
    const next = {
      items: Array.isArray(d?.items) ? d.items : [],
      estimate: d?.estimate ?? null,
      membership: d?.membership ?? null,
      rewards_available: Array.isArray(d?.rewards_available) ? d.rewards_available : [],
    };
    if (seq === cartSeq.current) {
      setServerCart(next);
      if (next.estimate?.special_offer) {
        setAppliedOffer(next.estimate.special_offer);
        localStorage.setItem('vishrea_applied_offer', JSON.stringify(next.estimate.special_offer));
      } else if (localStorage.getItem('vishrea_applied_offer')) {
        setAppliedOffer(null);
        localStorage.removeItem('vishrea_applied_offer');
      }
    }
    return d;
  }, []);

  const refreshCart = useCallback(async (codeOverride) => {
    if (mergePromise.current) await mergePromise.current;
    const seq = ++cartSeq.current;
    const code = codeOverride !== undefined ? codeOverride : (appliedOffer?.code || '');
    const url = code ? `/api/cart?code=${encodeURIComponent(code)}` : '/api/cart';
    return applyCart(await cachedGet(url), seq);
  }, [applyCart, appliedOffer]);

  const applyOffer = useCallback(async (code) => {
    if (!code || !String(code).trim()) throw new Error('Please enter a promo code');
    const clean = String(code).trim().toUpperCase();
    const res = await api('/api/offers/validate', { method: 'POST', body: { code: clean } });
    if (!res?.valid || !res?.offer) {
      throw new Error(res?.message || 'Invalid or expired offer code');
    }
    setAppliedOffer(res.offer);
    localStorage.setItem('vishrea_applied_offer', JSON.stringify(res.offer));
    invalidateCached();
    if (user) {
      await refreshCart(res.offer.code);
    }
    window.dispatchEvent(new CustomEvent('vishrea_toast', { detail: `Special offer "${res.offer.code}" applied!` }));
    return res.offer;
  }, [user, refreshCart]);

  const removeOffer = useCallback(async () => {
    setAppliedOffer(null);
    localStorage.removeItem('vishrea_applied_offer');
    invalidateCached();
    if (user) {
      await api('/api/cart', { method: 'POST', body: { action: 'remove_promo' } }).catch(() => {});
      await refreshCart('');
    }
    window.dispatchEvent(new CustomEvent('vishrea_toast', { detail: 'Offer code removed' }));
  }, [user, refreshCart]);

  useEffect(() => {
    refreshSession();
    // Clean up state written by earlier client builds (fake admin user, local orders/products).
    ['vishrea_react_user', 'vishrea_react_products', 'vishrea_react_categories', 'vishrea_react_orders', 'vishrea_react_cart', 'vishrea_react_membership', 'vishrea_react_colour_profile'].forEach((k) =>
      localStorage.removeItem(k)
    );

    // Check for direct access_token in URL hash (e.g. from email confirmation links)
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('access_token=')) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const tokenFromHash = hashParams.get('access_token');
      if (tokenFromHash) {
        api('/api/auth/session-exchange', {
          method: 'POST',
          body: { access_token: tokenFromHash },
        })
          .then((res) => {
            if (res?.user) {
              setUser(res.user);
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
              const dest = res.redirect_to || (res.user.is_admin ? '/admin' : '/account');
              window.location.href = dest;
            }
          })
          .catch((err) => console.warn('[Auth] Hash token exchange failed:', err));
      }
    }

    // Listen to Supabase auth events (e.g. magic link redirects or URL hash tokens)
    let unsub = null;
    import('../lib/supabase.js').then(({ getSupabase }) => {
      getSupabase().then(async (sb) => {
        if (!sb) return;

        const handleSession = async (session) => {
          if (!session?.access_token) return;
          try {
            const res = await api('/api/auth/session-exchange', {
              method: 'POST',
              body: { access_token: session.access_token },
            });
            if (res?.user) {
              setUser(res.user);
              if (window.location.hash.includes('access_token')) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
              }
            }
          } catch (err) {
            console.warn('[Auth] Auto-exchange from Supabase session failed:', err);
          }
        };

        const { data: initialSession } = await sb.auth.getSession().catch(() => ({ data: {} }));
        if (initialSession?.session) {
          await handleSession(initialSession.session);
        }

        const { data } = sb.auth.onAuthStateChange(async (event, session) => {
          if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
            await handleSession(session);
          }
        });
        unsub = data?.subscription;
      });
    });

    return () => {
      unsub?.unsubscribe();
    };
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

  const startLogin = useCallback(async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    try {
      const { sendOtpEmail, isSupabaseAvailable } = await import('../lib/supabase.js');
      if (isSupabaseAvailable()) {
        await sendOtpEmail(normalizedEmail);
        return {
          ok: true,
          provider: 'supabase',
          message: 'If this email can receive mail, a 6-digit code is on its way.',
        };
      }
    } catch (sbErr) {
      console.warn('[Auth] Supabase client OTP request failed, falling back to server:', sbErr);
    }
    return api('/api/auth/start-login', { method: 'POST', body: { email: normalizedEmail } });
  }, []);

  const verifyCode = useCallback(async (email, code) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();

    try {
      const { verifyEmailOtp, isSupabaseAvailable } = await import('../lib/supabase.js');
      if (isSupabaseAvailable()) {
        const sbData = await verifyEmailOtp(normalizedEmail, cleanCode);
        const accessToken = sbData?.session?.access_token;
        if (accessToken) {
          const res = await api('/api/auth/session-exchange', {
            method: 'POST',
            body: { access_token: accessToken },
          });
          setUser(res.user);
          return res;
        }
      }
    } catch (sbErr) {
      console.warn('[Auth] Supabase client OTP verify failed, falling back to server verify:', sbErr);
    }

    const d = await api('/api/auth/verify-code', { method: 'POST', body: { email: normalizedEmail, code: cleanCode } });
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
      const { signOutSupabase } = await import('../lib/supabase.js');
      await signOutSupabase().catch(() => {});
    } catch {}
    try {
      await api('/api/auth/signout', { method: 'POST', body: {} });
    } finally {
      setUser(null);
      setGuestCart([]);
      setSizeProfiles([]);
      setActiveSizeProfile(null);
      setMyOffers([]);
      setAppliedOffer(null);
      localStorage.removeItem('vishrea_applied_offer');
      setServerCart({ items: [], estimate: null, membership: null });
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
      sizeProfiles,
      activeSizeProfile,
      fitPreferences,
      sizeFilterEnabled,
      setSizeFilterEnabled,
      refreshSizeProfiles,
      switchActiveProfile,
      saveSizeProfile,
      deleteSizeProfile,
      myOffers,
      appliedOffer,
      applyOffer,
      removeOffer,
      refreshMyOffers,
    }),
    [user, authReady, refreshSession, startLogin, verifyCode, completeProfile, completeOnboarding, signOut, bag, serverCart, cartBusy, refreshCart, addToCart, updateCartItem, removeFromCart, colourProfile, setColourProfile, referral, sizeProfiles, activeSizeProfile, fitPreferences, sizeFilterEnabled, setSizeFilterEnabled, refreshSizeProfiles, switchActiveProfile, saveSizeProfile, deleteSizeProfile, myOffers, appliedOffer, applyOffer, removeOffer, refreshMyOffers]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
};
