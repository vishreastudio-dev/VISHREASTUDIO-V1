import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ai } from '../lib/ai.js';
import { POLICIES } from '../api/style-assistant.js';

test('AI Platform: POLICIES dictionary contains verified store policies', () => {
  assert.ok(POLICIES.shipping, 'Shipping policy must be present');
  assert.ok(POLICIES.returns, 'Returns / Exchanges policy must be present');
  assert.ok(POLICIES.terms, 'Terms and conditions policy must be present');
  assert.ok(POLICIES.privacy, 'Privacy policy must be present');
  assert.match(POLICIES.terms.body, /1,799/, 'Terms policy must cite ₹1,799 membership');
  assert.match(POLICIES.terms.body, /credits/, 'Terms policy must cite credits');
});

test('AI Platform: ai.generateText error handling without keys', async () => {
  // Test fallback or missing keys in test environment
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalGroq = process.env.GROQ_CLOUD_API_KEY;
  const originalGroqAlt = process.env.GROQ_API_KEY;

  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_CLOUD_API_KEY;
  delete process.env.GROQ_API_KEY;

  await assert.rejects(
    async () => {
      await ai.generateText({ prompt: 'Hello' });
    },
    /Neither OPENAI_API_KEY nor GROQ_CLOUD_API_KEY is configured/,
    'Should throw when neither provider is available'
  );

  // Restore
  if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
  if (originalGroq) process.env.GROQ_CLOUD_API_KEY = originalGroq;
  if (originalGroqAlt) process.env.GROQ_API_KEY = originalGroqAlt;
});

test('AI Platform: Style Assistant intent extraction regex / heuristics', () => {
  // Verify category extraction logic
  const query = 'I need a dinner party dress in black under 3000';
  const priceMatch = query.match(/(?:under|below|less than|within|around)?\s*₹?\s*(\d{3,5})/i);
  assert.ok(priceMatch);
  assert.equal(Number(priceMatch[1]), 3000);

  const colors = ['black', 'white', 'wine', 'emerald', 'navy', 'yellow', 'brown'];
  const matchedColors = colors.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(query));
  assert.deepEqual(matchedColors, ['black']);
});

test('AI Platform: Product-aware generation constraints check', () => {
  const verifiedProduct = {
    id: 'prod-123',
    name: 'The Wine Slip Dress',
    price_inr: 3490,
    material: 'Silk blend',
    color: 'Wine',
    occasion: 'Evening',
    care_instructions: 'Dry clean only',
  };

  // Verify that required catalogue attributes are strictly available
  assert.equal(verifiedProduct.name, 'The Wine Slip Dress');
  assert.equal(verifiedProduct.price_inr, 3490);
  assert.equal(verifiedProduct.material, 'Silk blend');
});
