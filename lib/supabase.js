import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { log } from './log.js';
import { AppError } from './http.js';

let supabaseClient = null;

export function getSupabaseAdmin() {
  if (supabaseClient) return supabaseClient;
  if (!config.supabase.url || (!config.supabase.serviceRoleKey && !config.supabase.anonKey)) {
    return null;
  }
  supabaseClient = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey || config.supabase.anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
  return supabaseClient;
}

/**
 * Validates a Supabase-issued JWT access token server-side:
 * 1. Checks structure and expiry
 * 2. Validates issuer (must match configured Supabase project) and audience ('authenticated')
 * 3. Calls Supabase Auth getUser(token) to cryptographically verify signature, active status,
 *    and non-revocation directly against the Supabase Auth server.
 */
export async function verifySupabaseAccessToken(token) {
  if (!token || typeof token !== 'string') {
    throw new AppError(401, 'invalid_token', 'No authentication token provided.');
  }

  // Pre-validate JWT structure and claims
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.payload) {
    throw new AppError(401, 'invalid_token', 'Invalid token format.');
  }

  const { iss, aud, exp, sub } = decoded.payload;
  const nowSec = Math.floor(Date.now() / 1000);

  if (exp && exp < nowSec) {
    throw new AppError(401, 'token_expired', 'Your session has expired. Please sign in again.');
  }

  // Verify token was issued for our Supabase project
  if (config.supabase.url) {
    const expectedIss = `${config.supabase.url}/auth/v1`;
    if (iss && iss !== expectedIss) {
      const projRef = config.supabase.projectRef;
      if (!projRef || !iss.includes(projRef)) {
        log.warn('auth.supabase_project_mismatch', { iss, expectedIss });
        throw new AppError(401, 'invalid_token', 'Token was not issued by the configured authentication provider.');
      }
    }
  }

  if (aud && aud !== 'authenticated') {
    throw new AppError(401, 'invalid_token', 'Token is not authorized for user sessions.');
  }

  const client = getSupabaseAdmin();
  if (!client) {
    // If Supabase client is not configured, we cannot verify live tokens
    throw new AppError(503, 'auth_unavailable', 'Supabase authentication is not configured.');
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    log.warn('auth.supabase_verify_failed', { error: error?.message });
    throw new AppError(401, 'invalid_token', error?.message || 'Invalid or revoked token.');
  }

  const user = data.user;
  if (!user.email) {
    throw new AppError(400, 'missing_email', 'Verified user account does not have an associated email address.');
  }

  return {
    id: user.id, // Supabase Auth UUID
    email: user.email.toLowerCase(),
    app_metadata: user.app_metadata || {},
    user_metadata: user.user_metadata || {},
  };
}

/**
 * Send passwordless Email OTP using Supabase Auth.
 */
export async function sendSupabaseOtp(email) {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new AppError(503, 'auth_unavailable', 'Supabase authentication service is not configured.');
  }

  const { data, error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    log.warn('auth.supabase_otp_failed', { email_domain: email.split('@')[1], error: error.message, status: error.status });
    if (error.status === 429) {
      throw new AppError(429, 'otp_throttled', 'Too many requests. Please wait before requesting another code.');
    }
    throw new AppError(400, 'otp_delivery_failed', error.message || 'Could not send verification code.');
  }

  return data;
}

/**
 * Verify Email OTP directly with Supabase Auth (server-side).
 */
export async function verifySupabaseOtp(email, code) {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new AppError(503, 'auth_unavailable', 'Supabase authentication service is not configured.');
  }

  const { data, error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  });

  if (error || !data?.session || !data?.user) {
    log.warn('auth.supabase_otp_verify_failed', { email_domain: email.split('@')[1], error: error?.message });
    throw new AppError(400, 'invalid_code', error?.message || 'That code is incorrect or has expired.');
  }

  return {
    session: data.session,
    user: {
      id: data.user.id,
      email: data.user.email.toLowerCase(),
      user_metadata: data.user.user_metadata || {},
    },
  };
}
