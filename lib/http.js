import crypto from 'crypto';
import { config, isAllowedOrigin } from './config.js';
import { log } from './log.js';

const AUTH_COOKIE_NAME = 'vishrea_auth';

/** An error whose status/code/message are safe to show to the client. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const notFound = (code = 'not_found', message = 'Not found') => new AppError(404, code, message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);

/** Forward async handler rejections to the Express error middleware (Express 4). */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function sendError(res, status, code, message, details) {
  if (res.headersSent) return;
  res.status(status).json({ error: code, message: message || code, ...(details ? { details } : {}), request_id: res.req?.id });
}

export function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

const storageOrigin = (() => {
  if (config.storage.driver !== 'supabase') return null;
  try {
    return new URL(config.storage.supabaseUrl).origin;
  } catch {
    return null;
  }
})();

function getCspDirectives() {
  const scriptSrc = [
    "'self'",
    "'wasm-unsafe-eval'",
    // In development / local testing, allow 'unsafe-eval' so browser QA extensions (e.g. Floto Design QA) and dev tools can evaluate scripts without CSP blocking.
    ...(!config.isProd ? ["'unsafe-eval'"] : []),
    "https://checkout.razorpay.com",
    "https://www.instagram.com",
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
    "frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.instagram.com",
    `img-src 'self' data: blob: https:${storageOrigin ? ` ${storageOrigin}` : ''}`,
    // Customer videos are served from the Supabase Storage project when that driver is active.
    `media-src 'self' blob:${storageOrigin ? ` ${storageOrigin}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com"), unload=*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
  } else if (config.cspMode !== 'off') {
    const baseDirectives = getCspDirectives();
    const directives = config.isProd ? [...baseDirectives, 'upgrade-insecure-requests'] : baseDirectives;
    const header = config.cspMode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
    res.setHeader(header, directives.join('; '));
  }
  next();
}

/** Redirect plain-HTTP traffic to HTTPS (behind a TLS-terminating proxy). */
export function httpsRedirect(req, res, next) {
  if (!config.forceHttps || req.secure || req.path === '/api/health') return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Redirect to the configured canonical host, never to a client-supplied Host header.
    const host = config.appOrigin ? new URL(config.appOrigin).host : req.headers.host;
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  }
  return sendError(res, 403, 'https_required', 'HTTPS is required');
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defence for cookie-authenticated mutations: the request must come from an allowed
 * origin (Origin, or Referer when Origin is absent) and carry a JSON body. Cookies are
 * SameSite=Lax as a second layer.
 */
export function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/webhooks/')) return next();

  const source = req.headers.origin || originOf(req.headers.referer || '');
  if (source) {
    const forwardedHost = req.headers['x-forwarded-host'];
    const forwardedProto = req.headers['x-forwarded-proto'] || req.protocol;
    const forwardedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
    const selfOrigin = `${req.protocol}://${req.headers.host}`;

    const isMatch =
      source === selfOrigin ||
      (forwardedOrigin && source === forwardedOrigin) ||
      isAllowedOrigin(source);

    if (!isMatch) {
      log.warn('security.origin_rejected', { origin: source, path: req.path, ip: req.ip });
      return sendError(res, 403, 'origin_not_allowed', 'Cross-origin request rejected');
    }
  } else if (req.cookies?.[AUTH_COOKIE_NAME] && !req.headers.authorization) {
    // Browsers always send Origin on POST/PUT/PATCH/DELETE. A cookie-authenticated mutation with
    // neither Origin nor Referer is not a browser on our site; non-browser clients use a Bearer token.
    log.warn('security.origin_missing', { path: req.path, ip: req.ip });
    return sendError(res, 403, 'origin_required', 'Cross-origin request rejected');
  }

  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) {
    return sendError(res, 415, 'unsupported_media_type', 'Request body must be application/json');
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  if (err?.type === 'entity.parse.failed') return sendError(res, 400, 'invalid_json', 'Malformed JSON body');
  if (err?.type === 'entity.too.large') return sendError(res, 413, 'payload_too_large', 'Request body is too large');
  if (err?.code === '22P02') return sendError(res, 400, 'invalid_identifier', 'Invalid identifier format');
  if (err?.code === '23505') return sendError(res, 409, 'duplicate', 'A record with these details already exists');
  if (err?.code === '23514') return sendError(res, 422, 'constraint_violation', 'The submitted values are not allowed');
  if (err?.code === '23503') return sendError(res, 409, 'reference_conflict', 'A related record does not exist or is still referenced');

  log.error('http.unhandled_error', { request_id: req.id, method: req.method, path: req.path, message: err?.message, stack: config.isProd ? undefined : err?.stack });
  return sendError(res, 500, 'internal_error', config.isProd ? 'Something went wrong. Please try again.' : err?.message || 'Internal error');
}
