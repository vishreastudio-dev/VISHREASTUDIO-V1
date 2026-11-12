import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { measurementText, productContentGaps, productFaqs } = await import('../vishrea-react/src/lib/productCopy.js');

test('product FAQs only answer what the catalogue knows', () => {
  const bare = productFaqs({ name: 'Linen Top', variants: [] });
  assert.deepEqual(bare.map((f) => f.q), ['Can I exchange it?', 'How is it delivered?']);
  const full = productFaqs({ name: 'Linen Top', material: '100% linen', care_instructions: 'Hand wash cold.', variants: [{ size_label: 'S', in_stock: true }, { size_label: 'M', in_stock: false }] });
  assert.equal(full.length, 4);
  assert.equal(full[0].a, '100% linen.');
  assert.equal(full[1].a, 'In stock now: S.');
  assert.equal(full[2].a, 'Hand wash cold.');
});

test('measurements show centimetres with inches, and only measured values', () => {
  assert.equal(measurementText({ measurements: { bust_cm: 86, waist_cm: null, hip_cm: '96', length_cm: 0 } }), 'Bust 86 cm (33.9 in) · Hip 96 cm (37.8 in)');
  assert.equal(measurementText({ measurements: {} }), null);
});

test('admin listing gaps name the missing facts', () => {
  assert.deepEqual(productContentGaps({ description: 'x'.repeat(90), material: 'Silk', care_instructions: 'Dry clean', color: 'Wine', bust_cm: 86, images: ['/a.jpg'] }), []);
  assert.deepEqual(productContentGaps({}), ['description (at least 80 characters)', 'material / fabric', 'care instructions', 'colour', 'measurements', 'photos']);
});
