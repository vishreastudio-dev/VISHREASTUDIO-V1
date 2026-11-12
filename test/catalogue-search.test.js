// Catalogue search: multi-field matching, typo correction, filters, sorting, pagination, the live
// suggestion endpoint, input validation and its rate limit. Products are created with made-up
// words ("quillon") so the demo catalogue cannot interfere.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ctx, dbSkipReason, login, setup, teardown, ADMIN_EMAIL } from './helpers.js';
import { cleanQuery, correctTokens, editDistance, listParam, rupeeParam, sortSizes, tokenize } from '../lib/search.js';

describe('search helpers', () => {
  test('queries are cleaned: control characters removed, whitespace collapsed, capped at 80', () => {
    assert.equal(cleanQuery('  wine\u0000\u0007  slip\n dress '), 'wine slip dress');
    assert.equal(cleanQuery('x'.repeat(200)).length, 80);
    assert.equal(cleanQuery(['array']), '');
    assert.equal(cleanQuery(undefined), '');
  });

  test('tokens are lowercase words without accents; single letters only when nothing else is left', () => {
    assert.deepEqual(tokenize('Wide-Leg  PANT'), ['wide', 'leg', 'pant']);
    assert.deepEqual(tokenize('Crêpe a'), ['crepe']);
    assert.deepEqual(tokenize('a'), ['a']);
    assert.deepEqual(tokenize('%_\\'), []);
  });

  test('list and price parameters are validated', () => {
    assert.deepEqual(listParam(['M', 'm', ' L ', '', 5, 'S']), ['M', 'L', 'S']);
    assert.equal(listParam(Array.from({ length: 50 }, (_, i) => `v${i}`)).length, 12);
    assert.deepEqual(listParam('Wine'), ['Wine']);
    assert.equal(rupeeParam('2500'), 2500);
    for (const bad of ['-1', '12.5', 'abc', '', '999999999', undefined, ['1']]) assert.equal(rupeeParam(bad), null, String(bad));
  });

  test('edit distance counts a swap of neighbouring letters as one edit', () => {
    assert.equal(editDistance('dress', 'dress'), 0);
    assert.equal(editDistance('drses', 'dress'), 1);
    assert.equal(editDistance('cardigna', 'cardigan'), 1);
    assert.equal(editDistance('silk', 'linen', 2), 3);
  });

  test('typo correction only ever uses words from the catalogue', () => {
    const vocabulary = ['dress', 'dresses', 'cardigan', 'wine', 'linen'];
    assert.deepEqual(correctTokens(['cardigna'], vocabulary), ['cardigan']);
    assert.deepEqual(correctTokens(['wine', 'drsess'], vocabulary), ['wine', 'dress']);
    assert.equal(correctTokens(['wine', 'dress'], vocabulary), null, 'known words are left alone');
    assert.equal(correctTokens(['xqzvbn'], vocabulary), null, 'nothing close enough: no guess');
    assert.equal(correctTokens(['dre'], vocabulary), null, 'a prefix of a real word is already a match');
    assert.equal(correctTokens(['abc'], ['abd']), null, 'words under four letters are never corrected');
  });

  test('sizes sort in wearing order with unknown labels last', () => {
    assert.deepEqual(sortSizes(['Free Size', 'L', 'Custom', 'S', 'XL', 'M']), ['S', 'M', 'L', 'XL', 'Free Size', 'Custom']);
  });
});

describe('recent searches (device storage)', () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  const load = () => import('../vishrea-react/src/lib/recentSearches.js');

  test('newest first, case-insensitive de-duplication, at most six', async () => {
    const { saveRecent, readRecent } = await load();
    for (const q of ['black', 'wine slip', 'Black', 'a', 'linen', 'silk', 'midi', 'coat', 'knit']) saveRecent(q);
    assert.deepEqual(readRecent(), ['knit', 'coat', 'midi', 'silk', 'linen', 'Black']);
  });

  test('contact or payment details are never stored', async () => {
    const { saveRecent, readRecent, clearRecent } = await load();
    clearRecent();
    for (const q of ['asha@example.com', '98450 00000', '+91-98450-00000', '4111 1111 1111 1111', 'order 123456']) saveRecent(q);
    assert.deepEqual(readRecent(), []);
    saveRecent('size 12 dress');
    assert.deepEqual(readRecent(), ['size 12 dress']);
  });

  test('corrupt or tampered storage is ignored', async () => {
    const { readRecent } = await load();
    store.set('vishrea.recent-searches', '{not json');
    assert.deepEqual(readRecent(), []);
    store.set('vishrea.recent-searches', JSON.stringify(['ok', 5, null, 'x'.repeat(200), 'me@mail.com']));
    assert.deepEqual(readRecent(), ['ok']);
  });
});

const skip = await dbSkipReason();
let admin;
const ids = {};

describe('catalogue search API', { skip, timeout: 300_000 }, () => {
  const ops = (section, body) => api('POST', `/api/admin/ops?section=${section}`, body, { cookie: admin.cookie });
  const product = async (key, body) => {
    const r = await ops('product', { is_one_of_one: false, ...body });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ids[key] = r.data.product.id;
    return r.data.product;
  };
  const search = async (query) => {
    const r = await api('GET', `/api/catalogue?${query}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const names = (d) => d.products.map((p) => p.name);

  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
    await product('wrap', { name: 'Quillon Wrap Dress', category: 'Dresses', color: 'Saffron', occasion: 'Festive', material: 'Handloom linen', variants: [{ size_label: 'S', price_inr: 3200, stock_quantity: 2 }, { size_label: 'M', price_inr: 3200, stock_quantity: 0 }] });
    await product('shirt', { name: 'Quillon Linen Shirt', category: 'Tops', color: 'Saffron', occasion: 'Office', variants: [{ size_label: 'L', price_inr: 1800, stock_quantity: 3 }] });
    await product('skirt', { name: 'Marigold Quillon Skirt', category: 'Skirts', color: 'Indigo', occasion: 'Festive', description: 'A bias-cut midi.', variants: [{ size_label: 'M', price_inr: 2500, stock_quantity: 1 }] });
    await product('sold', { name: 'Quillon Sold Cardigan', category: 'Cardigans', color: 'Indigo', variants: [{ size_label: 'M', price_inr: 2100, stock_quantity: 0 }] });
    const startsAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const publicAt = new Date(Date.now() + 9 * 86400_000).toISOString();
    assert.equal((await ops('drop', { name: 'Search Secret Drop', starts_at: startsAt, public_at: publicAt })).status, 200);
    const drop = (await ctx.db.query("SELECT id FROM drop_settings WHERE name = 'Search Secret Drop'")).rows[0];
    await product('hidden', { name: 'Zorblat Quillon Gown', category: 'Dresses', color: 'Saffron', drop_id: drop.id, variants: [{ size_label: 'M', price_inr: 9000, stock_quantity: 1 }] });
  }, { timeout: 120_000 });
  after(teardown);

  test('a full product name ranks that product first (best match is the default when searching)', async () => {
    const d = await search('q=Quillon%20Wrap%20Dress');
    assert.equal(d.sort, 'relevance');
    assert.equal(d.products[0].name, 'Quillon Wrap Dress');
    assert.equal(d.total, 1);
    assert.equal(d.query, 'Quillon Wrap Dress');
  });

  test('a partial word matches every piece containing it; hidden drop pieces never appear', async () => {
    const d = await search('q=quill');
    assert.deepEqual(names(d).sort(), ['Marigold Quillon Skirt', 'Quillon Linen Shirt', 'Quillon Sold Cardigan', 'Quillon Wrap Dress']);
    assert.ok(!names(d).includes('Zorblat Quillon Gown'));
  });

  test('category, colour, occasion and material are searched', async () => {
    assert.ok(names(await search('q=quillon%20skirts')).includes('Marigold Quillon Skirt'), 'category name');
    assert.deepEqual(names(await search('q=saffron%20quillon')).sort(), ['Quillon Linen Shirt', 'Quillon Wrap Dress'], 'colour');
    assert.deepEqual(names(await search('q=festive%20quillon')).sort(), ['Marigold Quillon Skirt', 'Quillon Wrap Dress'], 'occasion');
    assert.deepEqual(names(await search('q=handloom%20quillon')), ['Quillon Wrap Dress'], 'material');
    assert.deepEqual(names(await search('q=bias-cut%20quillon')), ['Marigold Quillon Skirt'], 'description');
  });

  test('a misspelt word is corrected to a catalogue word only when the query finds nothing', async () => {
    const d = await search('q=quilon');
    assert.equal(d.corrected_query, 'quillon');
    assert.equal(d.total, 4);
    assert.equal((await search('q=quillon')).corrected_query, null);
    const none = await search('q=xqzvbnm');
    assert.equal(none.total, 0);
    assert.equal(none.corrected_query, null);
  });

  test('a correction can never surface an unreleased piece', async () => {
    for (const q of ['zorblat', 'zorblatt', 'zorbalt']) {
      const d = await search(`q=${q}`);
      assert.equal(d.total, 0, q);
      assert.equal(d.corrected_query, null, q);
      const s = await api('GET', `/api/search?q=${q}`);
      assert.equal(s.data.total, 0, q);
      assert.equal(s.data.corrected_query, null, q);
    }
  });

  test('filters combine: size (in stock in that size), colour, occasion, price, availability', async () => {
    assert.deepEqual(names(await search('q=quillon&size=S')), ['Quillon Wrap Dress']);
    assert.deepEqual(names(await search('q=quillon&size=M')), ['Marigold Quillon Skirt'], 'a sold-out size does not match');
    assert.equal((await search('q=quillon&colour=Saffron&colour=indigo')).total, 4, 'several colours, any case');
    assert.deepEqual(names(await search('q=quillon&occasion=Festive&size=M')), ['Marigold Quillon Skirt']);
    assert.deepEqual(names(await search('q=quillon&price_min=2000&price_max=3000')).sort(), ['Marigold Quillon Skirt', 'Quillon Sold Cardigan']);
    assert.deepEqual(names(await search('q=quillon&price_min=3000&price_max=2000')).sort(), ['Marigold Quillon Skirt', 'Quillon Sold Cardigan'], 'reversed bounds are swapped');
    const inStock = await search('q=quillon&in_stock=true');
    assert.ok(!names(inStock).includes('Quillon Sold Cardigan'));
    assert.equal(inStock.total, 3);
    assert.equal((await search('q=quillon&category=tops')).total, 1);
  });

  test('filter options list only values that exist among the matching pieces', async () => {
    const { facets } = await search('q=quillon');
    assert.deepEqual(facets.sizes, ['S', 'M', 'L'], 'in-stock sizes only, in wearing order');
    assert.deepEqual(facets.colours, ['Indigo', 'Saffron']);
    assert.deepEqual(facets.occasions, ['Festive', 'Office']);
    assert.deepEqual(facets.price, { min: 1800, max: 3200 });
    const none = await search('q=xqzvbnm');
    assert.deepEqual(none.facets, { sizes: [], colours: [], occasions: [], price: null });
    assert.equal((await search('q=quillon&page=2&limit=2')).facets, undefined, 'only the first page carries them');
  });

  test('sorting uses real prices and names', async () => {
    assert.deepEqual(names(await search('q=quillon&in_stock=true&sort=price_asc')), ['Quillon Linen Shirt', 'Marigold Quillon Skirt', 'Quillon Wrap Dress']);
    assert.deepEqual(names(await search('q=quillon&in_stock=true&sort=price_desc')), ['Quillon Wrap Dress', 'Marigold Quillon Skirt', 'Quillon Linen Shirt']);
    assert.deepEqual(names(await search('q=quillon&in_stock=true&sort=name')), ['Marigold Quillon Skirt', 'Quillon Linen Shirt', 'Quillon Wrap Dress']);
    assert.equal((await search('sort=relevance&limit=1')).sort, 'featured', 'best match needs a query');
  });

  test('pages of a search never repeat or skip a piece', async () => {
    const seen = [];
    for (const page of [1, 2]) {
      const d = await search(`q=quillon&limit=2&page=${page}&sort=price_asc`);
      assert.equal(d.total, 4);
      seen.push(...d.products.map((p) => p.id));
    }
    assert.equal(new Set(seen).size, 4);
    const all = (await search('limit=100&sort=featured')).products.map((p) => p.id);
    const paged = [];
    for (let page = 1; paged.length < all.length && page < 20; page += 1) paged.push(...(await search(`limit=7&page=${page}&sort=featured`)).products.map((p) => p.id));
    assert.deepEqual(paged, all, 'ties in the sort order are broken the same way on every page');
  });

  test('invalid input is cleaned or ignored, never a server error', async () => {
    for (const query of [
      'q=%00%01wine',
      `q=${'x'.repeat(500)}`,
      'q=%25%5F%5C',
      'price_min=abc&price_max=-5&size=&colour=',
      `${Array.from({ length: 40 }, (_, i) => `size=s${i}`).join('&')}`,
      'sort=;drop&limit=abc&page=-3',
      'q[]=a&q[]=b&size[x]=1',
    ]) {
      const r = await api('GET', `/api/catalogue?${query}`);
      assert.equal(r.status, 200, `${query} → ${r.status}`);
    }
    assert.equal((await search(`q=${'y'.repeat(500)}`)).query.length, 80);
    assert.equal((await search('q=%25')).total, 0, 'symbols alone (including LIKE wildcards) match nothing');
    for (const q of ['%00', '%5B%5D', 'a'.repeat(300)]) assert.equal((await api('GET', `/api/search?q=${q}`)).status, 200);
  });

  test('suggestions: categories and pieces from the live catalogue only', async () => {
    const s = await api('GET', '/api/search?q=quillon');
    assert.equal(s.status, 200);
    assert.equal(s.data.total, 4);
    assert.deepEqual(new Set(s.data.products.map((p) => p.id)).size, s.data.products.length, 'no duplicates');
    const rows = (await ctx.db.query(
      `SELECT p.id, p.name, c.name AS category, min(v.price_inr)::numeric AS price, bool_or(v.stock_quantity > 0) AS available
         FROM products p LEFT JOIN categories c ON c.id = p.category_id JOIN product_variants v ON v.product_id = p.id AND v.is_active
        WHERE p.id = ANY($1) AND p.is_active GROUP BY p.id, c.name`,
      [s.data.products.map((p) => p.id)]
    )).rows;
    assert.equal(rows.length, s.data.products.length, 'every suggested piece exists and is active');
    for (const p of s.data.products) {
      const row = rows.find((r) => r.id === p.id);
      assert.deepEqual({ name: p.name, category: p.category, price: p.price_inr, available: p.available }, { name: row.name, category: row.category, price: Number(row.price), available: row.available });
    }
    assert.deepEqual(s.data.categories.map((c) => [c.slug, c.count]).sort(), [['cardigans', 1], ['dresses', 1], ['skirts', 1], ['tops', 1]]);
    assert.ok(s.data.categories.every((c) => c.name_match === false));

    const cat = await api('GET', '/api/search?q=skirts');
    assert.equal(cat.data.categories[0].slug, 'skirts');
    assert.equal(cat.data.categories[0].name_match, true);

    const typo = await api('GET', '/api/search?q=quilon');
    assert.equal(typo.data.corrected_query, 'quillon');
    assert.equal(typo.data.total, 4);
  });

  test('an empty or one-letter query returns categories that have pieces, not results', async () => {
    for (const q of ['', 'q']) {
      const s = await api('GET', `/api/search?q=${q}`);
      assert.equal(s.status, 200);
      assert.deepEqual(s.data.products, []);
      assert.ok(s.data.browse.length > 0);
      assert.ok(s.data.browse.every((c) => c.count > 0 && c.slug && c.name));
    }
  });

  test('suggestions are rate limited per visitor', async () => {
    const { resetRateLimits } = await import('../lib/rate-limit.js');
    resetRateLimits();
    process.env.RATE_LIMIT_DISABLED = 'false';
    try {
      const statuses = [];
      for (let i = 0; i < 121; i += 1) statuses.push((await api('GET', `/api/search?q=rate${i % 3}`)).status);
      assert.equal(statuses.filter((s) => s === 200).length, 120);
      const last = await api('GET', '/api/search?q=rate');
      assert.equal(last.status, 429);
      assert.equal(last.data.error, 'rate_limited');
      assert.ok(Number(last.headers.get('retry-after')) > 0);
    } finally {
      process.env.RATE_LIMIT_DISABLED = 'true';
      resetRateLimits();
    }
  });

  test('only GET is accepted', async () => {
    assert.equal((await api('POST', '/api/search', { q: 'x' })).status, 405);
  });
});
