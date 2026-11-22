import { createClient } from '@supabase/supabase-js';

let client = null;
let initPromise = null;

const staticUrl = import.meta.env.VITE_SUPABASE_URL || '';
const staticAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (staticUrl && staticAnonKey) {
  try {
    client = createClient(staticUrl, staticAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    console.warn('[Supabase] Failed to initialize static client:', err);
  }
}

/**
 * Ensures the Supabase client is initialized.
 * Falls back to runtime /api/auth/config if static env variables were not injected.
 */
export async function getSupabase() {
  if (client) return client;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const res = await fetch('/api/auth/config', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data?.supabase_url && data?.supabase_anon_key) {
          client = createClient(data.supabase_url, data.supabase_anon_key, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          });
          return client;
        }
      }
    } catch (err) {
      console.warn('[Supabase] Failed to fetch runtime config:', err);
    }
    return null;
  })();

  return initPromise;
}

export function isSupabaseAvailable() {
  return Boolean(client || (staticUrl && staticAnonKey));
}

/**
 * Send passwordless Email OTP via Supabase Auth.
 */
export async function sendOtpEmail(email) {
  const sb = await getSupabase();
  if (!sb) {
    throw new Error('Supabase client is not configured.');
  }

  const { data, error } = await sb.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Verify Email OTP via Supabase Auth.
 * Automatically tries 'email' (login), 'signup' (new registration), and 'magiclink'.
 * Returns the session containing access_token.
 */
export async function verifyEmailOtp(email, token) {
  const sb = await getSupabase();
  if (!sb) {
    throw new Error('Supabase client is not configured.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();

  // 1. Try type: 'email' (for existing user login OTP)
  let { data, error } = await sb.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type: 'email',
  });

  // 2. If rejected, try type: 'signup' (for new customer registration verification)
  if (error || !data?.session) {
    const signupRes = await sb.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'signup',
    });
    if (!signupRes.error && signupRes.data?.session) {
      data = signupRes.data;
      error = null;
    }
  }

  // 3. Fallback to type: 'magiclink'
  if (error || !data?.session) {
    const mlRes = await sb.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'magiclink',
    });
    if (!mlRes.error && mlRes.data?.session) {
      data = mlRes.data;
      error = null;
    }
  }

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Sign out from Supabase client local state.
 */
export async function signOutSupabase() {
  try {
    const sb = await getSupabase();
    if (sb) {
      await sb.auth.signOut();
    }
  } catch (err) {
    console.warn('[Supabase] Sign-out warning:', err);
  }
}
