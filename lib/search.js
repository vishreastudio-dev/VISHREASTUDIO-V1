// Catalogue search on the live products table: every query word must appear in one of the
// product's searchable fields (name, category, colour, occasion, material, colour season,
// description). Typo correction only runs when a query finds nothing, and only swaps a word for
// one that appears in the visible catalogue, so it can never surface invented terms.
import { dropVisibleSql } from './catalogue.js';
import { cachedPublic } from './public-cache.js';

export const QUERY_MAX = 80;
export const SUGGEST_MIN = 2;
const MAX_TOKENS = 6;
const LIST_MAX = 12;

/** Control characters (including U+0000, which PostgreSQL rejects) removed, whitespace collapsed. */
export function cleanQuery(raw, max = QUERY_MAX) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Lowercase search words. Single characters are dropped unless nothing else is left. */
export function tokenize(q) {
  const words = [...new Set(fold(q).split(/[^a-z0-9]+/).filter(Boolean))];
  const useful = words.filter((w) => w.length > 1);
  return (useful.length ? useful : words).slice(0, MAX_TOKENS);
}

/** Repeated (`?size=S&size=M`) or single query values: cleaned, de-duplicated, capped. */
export function listParam(value, { max = 60 } = {}) {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const s = cleanQuery(typeof v === 'string' ? v : '', max);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= LIST_MAX) break;
  }
  return out;
}

/** A whole-rupee bound, or null when missing or invalid. */
export function rupeeParam(value) {
  if (typeof value !== 'string' || !/^\d{1,8}$/.test(value.trim())) return null;
  return Number(value.trim());
}

const likeTerm = (t) => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** SQL text the query words are matched against. Needs `products p` and `categories c`. */
export const SEARCH_DOC = "lower(concat_ws(' ', p.name, c.name, p.color, p.occasion, p.material, p.colour_season, p.description))";
const NAME_DOC = 'lower(p.name)';
const NAME_CATEGORY_DOC = "lower(concat_ws(' ', p.name, c.name))";
const ATTRIBUTE_DOC = "lower(concat_ws(' ', p.name, c.name, p.color, p.occasion, p.material, p.colour_season))";

/**
 * WHERE fragment and best-match ORDER BY for `tokens`, pushing values onto `params`.
 * `allIn(sqlText)` tests whether every word appears in another lowercased SQL expression.
 * Returns null for an empty query.
 */
export function matchSql(tokens, params) {
  if (!tokens.length) return null;
  const refs = tokens.map((t) => {
    params.push(likeTerm(t));
    return `$${params.length}`;
  });
  const all = (doc) => refs.map((r) => `${doc} LIKE ${r}`).join(' AND ');
  // PostgreSQL refuses unused parameters, so the phrase is only added when ranking is asked for.
  let relevance = null;
  return {
    where: `(${all(SEARCH_DOC)})`,
    allIn: all,
    get relevance() {
      if (!relevance) {
        params.push(tokens.join(' '));
        const phrase = `$${params.length}`;
        relevance = `CASE
      WHEN ${NAME_DOC} = ${phrase} THEN 0
      WHEN ${NAME_DOC} LIKE ${phrase} || '%' THEN 1
      WHEN ${all(NAME_DOC)} THEN 2
      WHEN ${all(NAME_CATEGORY_DOC)} THEN 3
      WHEN ${all(ATTRIBUTE_DOC)} THEN 4
      ELSE 5 END`;
      }
      return relevance;
    },
  };
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), capped. */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1);
      rows[i][j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > cap) return cap + 1;
  }
  return rows[a.length][b.length];
}

const allowedTypos = (len) => (len < 4 ? 0 : len < 7 ? 1 : 2);

/**
 * Closest catalogue word for a word that matches nothing. Compares against whole words and
 * against word beginnings of similar length, so a half-typed word with a slip still corrects.
 */
function closestWord(token, vocabulary) {
  const cap = allowedTypos(token.length);
  if (!cap) return null;
  let best = null;
  for (const word of vocabulary) {
    const whole = editDistance(token, word, cap);
    let d = whole;
    if (word.length > token.length) {
      for (const len of [token.length, token.length + 1]) d = Math.min(d, editDistance(token, word.slice(0, len), cap));
    }
    if (d > cap) continue;
    // Prefer fewer edits, then a whole-word match, then the shorter word (it also matches longer forms).
    const rank = [d, whole <= cap ? 0 : 1, word.length];
    if (!best || isBetter(rank, word, best)) best = { word, rank };
  }
  return best?.word ?? null;
}

function isBetter(rank, word, best) {
  for (let i = 0; i < rank.length; i += 1) if (rank[i] !== best.rank[i]) return rank[i] < best.rank[i];
  return word < best.word;
}

/**
 * Tokens with unmatched words swapped for their closest catalogue word, or null when nothing
 * could be corrected. A word already found inside some catalogue word is kept as typed.
 */
export function correctTokens(tokens, vocabulary) {
  const words = [...vocabulary];
  let changed = false;
  const out = tokens.map((t) => {
    if (words.some((w) => w.includes(t))) return t;
    const fix = closestWord(t, words);
    if (fix && fix !== t) {
      changed = true;
      return fix;
    }
    return t;
  });
  return changed ? [...new Set(out)] : null;
}

/** Words (3+ letters) from the visible catalogue's names and short attributes. */
export function vocabularyFrom(rows) {
  const words = new Set();
  for (const r of rows) {
    for (const v of Object.values(r)) {
      if (typeof v !== 'string') continue;
      for (const w of fold(v).split(/[^a-z0-9]+/)) if (w.length >= 3 && !/^\d+$/.test(w)) words.add(w);
    }
  }
  return words;
}

/**
 * Words of the products this visitor can see. Drop pieces still hidden from them never
 * contribute, so a correction cannot reveal an unreleased name.
 */
export async function catalogueVocabulary(db, visibility) {
  const key = `search:vocabulary:${visibility.member ? 'member' : 'public'}:${visibility.earlyHours}`;
  const r = await cachedPublic(key, 60_000, async () => {
    const rows = await db.query(
      `SELECT p.name, c.name AS category, p.color, p.occasion, p.material, p.colour_season
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true AND p.archived_at IS NULL AND ${dropVisibleSql('p', visibility)}
          AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)`
    );
    return [...vocabularyFrom(rows.rows)];
  });
  return r.value;
}

const SIZE_ORDER = ['xxs', 'xs', 's', 'small', 'm', 'medium', 'l', 'large', 'xl', 'xxl', 'double xl', '2xl', 'xxxl', '3xl', 'free size'];

/** Sizes in wearing order (XS → XL → Free Size), unknown labels alphabetically after. */
export function sortSizes(sizes) {
  const at = (s) => {
    const i = SIZE_ORDER.indexOf(s.toLowerCase());
    return i === -1 ? SIZE_ORDER.length : i;
  };
  return [...sizes].sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}
