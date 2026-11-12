// Colour profile maths without a browser: colour conversions, CIEDE2000, product colour parsing
// and palette-to-product matching. (Face detection and skin extraction run in the browser.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { rgbToHsv, rgbToLab } = await import('../vishrea-react/src/lib/colourEngine.js');
const { deltaE2000, matchProducts, productColour } = await import('../vishrea-react/src/lib/colourMatch.js');

test('CIEDE2000 matches the published reference pairs (Sharma, Wu & Dalal 2005)', () => {
  const pairs = [
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 }, 2.3669],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
    [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
    [{ L: 22.7233, a: 20.0904, b: -46.694 }, { L: 23.0331, a: 14.973, b: -42.5619 }, 2.0373],
  ];
  for (const [a, b, expected] of pairs) assert.ok(Math.abs(deltaE2000(a, b) - expected) < 1e-3, `${deltaE2000(a, b)} vs ${expected}`);
  assert.equal(deltaE2000({ L: 50, a: 10, b: 10 }, { L: 50, a: 10, b: 10 }), 0);
});

test('CIELAB and HSV conversions', () => {
  const white = rgbToLab(255, 255, 255);
  // The standard 4-decimal sRGB matrix leaves white a hundredth of a unit off neutral: invisible.
  assert.ok(Math.abs(white.L - 100) < 0.01 && Math.abs(white.a) < 0.05 && Math.abs(white.b) < 0.05);
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  const skin = rgbToHsv(224, 172, 140);
  assert.ok(skin.h > 20 && skin.h < 25 && skin.s > 0.35 && skin.s < 0.4);
});

test('product colour names map to reference colours', () => {
  assert.equal(productColour('Mustard Yellow').name, 'mustard yellow');
  assert.equal(productColour('Wine').hex, '#5E1A2B');
  assert.equal(productColour('Black & White').name, 'black');
  assert.equal(productColour('Dusty Rose Pink').name, 'dusty rose');
  assert.equal(productColour('Sage green').name, 'sage');
  assert.equal(productColour('Unicorn sparkle'), null);
  assert.equal(productColour(null), null);
});

test('products are matched to the palette by colour difference, never to "try less" colours', () => {
  const softAutumn = {
    season: 'Soft Autumn',
    bestColors: [['Sage', '#8F9C7A'], ['Dusty Rose', '#C08B80'], ['Soft Teal', '#5E8C88']],
    neutrals: [['Mushroom', '#B5A898'], ['Oat', '#E3D7C3']],
    lessColors: [['Neon Pink', '#F20A7A'], ['Pure White', '#FFFFFF'], ['Royal Blue', '#2747B8']],
  };
  const products = [
    { id: 'sage', color: 'Sage', colour_season: null },
    { id: 'taupe', color: 'Taupe', colour_season: null },
    { id: 'royal', color: 'Royal Blue', colour_season: 'Soft Autumn' },
    { id: 'neon', color: 'Hot Pink', colour_season: null },
    { id: 'tagged', color: 'Unicorn sparkle', colour_season: 'Soft Autumn' },
    { id: 'black', color: 'Black', colour_season: null },
  ];
  const m = matchProducts(products, softAutumn, 10);
  const ids = m.map((x) => x.product.id);
  assert.equal(ids[0], 'sage', 'an exact palette colour ranks first');
  assert.equal(m[0].deltaE, 0);
  assert.equal(m[0].reason, 'Close to your Sage');
  assert.ok(ids.includes('taupe'), 'a near colour (taupe, by mushroom) is recommended');
  assert.ok(ids.includes('tagged'), 'a season-tagged piece with an unknown colour name is kept');
  assert.ok(!ids.includes('royal'), 'a "try less" colour is excluded even when tagged with the season');
  assert.ok(!ids.includes('neon'), 'a colour close to a "try less" colour is excluded');
  assert.ok(!ids.includes('black'), 'a colour far from the palette is not recommended');
  assert.deepEqual(matchProducts(products, null), []);
});
