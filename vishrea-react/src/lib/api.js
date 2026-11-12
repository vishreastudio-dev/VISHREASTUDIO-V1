// Single HTTP client for the storefront and admin. Every call has a timeout, returns parsed
// JSON, and throws ApiError with a user-presentable message. Mutations are never retried here.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const FRIENDLY = {
  0: 'You appear to be offline. Check your connection and try again.',
  401: 'Please sign in to continue.',
  403: 'You do not have access to this.',
  404: 'We could not find what you were looking for.',
  408: 'The request took too long. Please try again.',
  413: 'That file is too large.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: 'Something went wrong on our side. Please try again.',
  502: 'A service we depend on is unavailable. Please try again shortly.',
  503: 'This service is temporarily unavailable.',
};

const listeners = new Set();
/** Subscribe to 401 responses (session expired). */
export const onUnauthorized = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function api(path, { method = 'GET', body, signal, timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const timedOut = controller.signal.reason?.name === 'TimeoutError';
    throw new ApiError(timedOut ? 408 : 0, timedOut ? 'timeout' : 'network_error', FRIENDLY[timedOut ? 408 : 0]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401) listeners.forEach((fn) => fn());
    const message = (data && data.message && data.message !== data.error ? data.message : null) || FRIENDLY[res.status] || FRIENDLY[500];
    throw new ApiError(res.status, data?.error || `http_${res.status}`, message, data?.details);
  }
  return data;
}

api.get = (path, opts) => api(path, { method: 'GET', ...opts });
api.post = (path, body, opts) => api(path, { method: 'POST', body, ...opts });
api.put = (path, body, opts) => api(path, { method: 'PUT', body, ...opts });
api.delete = (path, opts) => api(path, { method: 'DELETE', ...opts });

export const isAbort = (err) => err?.name === 'AbortError';

// Shared GET layer: one in-flight request per URL (components mounting together, or React
// StrictMode's dev double-mount, share it instead of cancelling and re-sending), optional reuse
// for `maxAge` ms, and a bounded retry when the API is unreachable. Application errors (a JSON
// error body, 4xx) are never retried. Only public data should be given a maxAge.
const GET_CACHE_LIMIT = 100;
const getCache = new Map();
const RETRY_DELAYS_MS = [400, 1200];
const isTransient = (err) => err instanceof ApiError && (err.status === 0 || [502, 503, 504].includes(err.status) || err.code === 'http_500');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api(path);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransient(err)) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Cached data for `path` if it is younger than `maxAge` ms, else undefined. */
export function peekCached(path, maxAge) {
  const hit = getCache.get(path);
  return hit && 'data' in hit && maxAge > 0 && Date.now() - hit.at < maxAge ? hit.data : undefined;
}

export function cachedGet(path, { maxAge = 0 } = {}) {
  const hit = getCache.get(path);
  if (hit?.promise) return hit.promise;
  const fresh = peekCached(path, maxAge);
  if (fresh !== undefined) return Promise.resolve(fresh);
  const promise = getWithRetry(path).then(
    (data) => {
      if (getCache.get(path)?.promise === promise) getCache.set(path, { at: Date.now(), data });
      return data;
    },
    (err) => {
      if (getCache.get(path)?.promise === promise) getCache.delete(path);
      throw err;
    }
  );
  getCache.delete(path);
  getCache.set(path, { promise });
  if (getCache.size > GET_CACHE_LIMIT) getCache.delete(getCache.keys().next().value);
  return promise;
}

/** Drop cached GETs whose URL starts with `prefix` (all of them when omitted). */
export function invalidateCached(prefix = '') {
  for (const key of [...getCache.keys()]) if (key.startsWith(prefix)) getCache.delete(key);
}

export const formatINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: Number(v) % 1 ? 2 : 0 }).format(Number(v) || 0);

/** Read a File as a data URL (for the JSON upload endpoint). */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file. `purpose` decides where it is stored and who can see it: product, banner,
 * instagram, video (staff) or evidence (customers; private). The response's `ref` is the value
 * to save; `url` can be displayed straight away (a short-lived link for private files).
 */
export async function uploadFile(file, kind = 'image', purpose) {
  const dataUrl = await readAsDataUrl(file);
  return api('/api/upload', { method: 'POST', body: { [kind]: dataUrl, name: file.name, ...(purpose ? { purpose } : {}) }, timeoutMs: 120000 });
}

/**
 * Upload an image to the same endpoint as `uploadFile`, reporting progress (0-100) while the bytes
 * are sent. Uses XMLHttpRequest because fetch cannot report upload progress.
 */
export async function uploadWithProgress(file, onProgress, { kind = 'image', purpose, timeoutMs = 120000 } = {}) {
  const body = JSON.stringify({ [kind]: await readAsDataUrl(file), name: file.name, ...(purpose ? { purpose } : {}) });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) listeners.forEach((fn) => fn());
      const message = (data && data.message && data.message !== data.error ? data.message : null) || FRIENDLY[xhr.status] || FRIENDLY[500];
      reject(new ApiError(xhr.status, data?.error || `http_${xhr.status}`, message, data?.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error', FRIENDLY[0]));
    xhr.ontimeout = () => reject(new ApiError(408, 'timeout', FRIENDLY[408]));
    xhr.send(body);
  });
}

let razorpayLoader = null;
/** Load Razorpay Checkout on demand (only on payment pages). */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!razorpayLoader) {
    razorpayLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay unavailable')));
      s.onerror = () => {
        razorpayLoader = null;
        reject(new ApiError(0, 'razorpay_load_failed', 'Could not load the payment window. Check your connection and try again.'));
      };
      document.body.appendChild(s);
    });
  }
  return razorpayLoader;
}
