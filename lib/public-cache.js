// Short-lived, in-process cache for public responses that are identical for every guest and
// non-member (catalogue, product pages, homepage content). Concurrent identical requests share one
// database read. Cleared after any committed stock change and any admin write on this instance;
// other instances converge within the TTL, which is shorter than the responses' own Cache-Control.
// A cache failure can only cost a database read: callers always fall back to `load()`.
const MAX_ENTRIES = 500;
const store = new Map();
let generation = 0;

export async function cachedPublic(key, ttlMs, load) {
  if (process.env.PUBLIC_CACHE === 'off') return { value: await load(), cached: false };
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return { value: await hit.value, cached: !hit.pending };
  const gen = generation;
  const entry = { expires: now + ttlMs, pending: true, value: null };
  entry.value = load().then(
    (v) => {
      entry.pending = false;
      // A write that committed while this read was running makes its result unsafe to keep.
      if (gen !== generation && store.get(key) === entry) store.delete(key);
      return v;
    },
    (err) => {
      if (store.get(key) === entry) store.delete(key);
      throw err;
    }
  );
  store.delete(key);
  store.set(key, entry);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  return { value: await entry.value, cached: false };
}

export function invalidatePublicCache() {
  generation += 1;
  store.clear();
}

/** Stable cache key from selected query parameters (order-insensitive). */
export function queryKey(prefix, query, keys) {
  return `${prefix}?${keys.map((k) => `${k}=${String(query?.[k] ?? '').trim().toLowerCase().slice(0, 80)}`).join('&')}`;
}
