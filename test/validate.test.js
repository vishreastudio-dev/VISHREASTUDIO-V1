import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { text, email } = await import('../lib/validate.js');

test('text rejects a null byte instead of letting PostgreSQL raise', () => {
  assert.throws(() => text('QA\u0000B', { field: 'full_name' }), (err) => err.status === 400 && err.code === 'invalid_full_name');
  assert.throws(() => text(' \u0000 ', { field: 'full_name', required: true }), (err) => err.status === 400 && err.code === 'invalid_full_name');
  assert.equal(text('QA ✨ ಕನ್ನಡ', { field: 'full_name' }), 'QA ✨ ಕನ್ನಡ');
});

test('email rejects a null byte before the format check', () => {
  assert.throws(() => email('a\u0000@qa.test'), (err) => err.status === 400 && err.code === 'invalid_email');
});
