// Recent searches, kept only on this device. Queries that look like contact or payment details
// (an @, or a run of six or more digits) are never stored.
const KEY = 'vishrea.recent-searches';
const MAX = 6;
const SENSITIVE = /@|(?:\d[\s-]?){6,}/;

const clean = (q) => String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);

export function readRecent() {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s && s.length <= 80 && !SENSITIVE.test(s)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    if (list.length) window.localStorage.setItem(KEY, JSON.stringify(list));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage can be full or disabled (private browsing); recent searches are optional.
  }
  return list;
}

export function saveRecent(q) {
  const s = clean(q);
  if (s.length < 2 || SENSITIVE.test(s)) return readRecent();
  return write([s, ...readRecent().filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, MAX));
}

export const clearRecent = () => write([]);
