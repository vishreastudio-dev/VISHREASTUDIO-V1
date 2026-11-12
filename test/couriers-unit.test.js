// Tracking-link generation, without a database. Environment is set before the modules load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef';

const { buildTrackingUrl, trackingNumber } = await import('../lib/couriers.js');
const { previewTrackingUrl } = await import('../vishrea-react/src/lib/couriers.js');

test('AWB is URL-encoded and only https links are produced', () => {
  assert.equal(buildTrackingUrl('https://t.example/track/{tracking}', 'AB 12/3'), 'https://t.example/track/AB%2012%2F3');
  assert.equal(buildTrackingUrl('https://t.example/q?awb={tracking}&x={tracking}', 'A&B'), 'https://t.example/q?awb=A%26B&x=A%26B');
  assert.equal(buildTrackingUrl('https://t.example/static', 'X1'), 'https://t.example/static');
  assert.equal(buildTrackingUrl('http://t.example/{tracking}', 'X1'), null);
  assert.equal(buildTrackingUrl('javascript:alert({tracking})', 'X1'), null);
  assert.equal(buildTrackingUrl('https://t.example/{tracking}', ''), null);
  assert.equal(buildTrackingUrl('', 'X1'), null);
});

test('the admin preview builds the same link as the server', () => {
  for (const [tpl, awb] of [['https://t.example/track/{tracking}', 'AB 12/3'], ['https://t.example/static', 'X'], ['http://t.example/{tracking}', 'X']]) {
    assert.equal(previewTrackingUrl(tpl, awb), buildTrackingUrl(tpl, awb));
  }
});

test('tracking numbers allow courier formats and refuse markup', () => {
  for (const ok of ['VS-DEL-98210', 'EE123456789IN', 'AB 12/3', 'X1']) assert.equal(trackingNumber(ok), ok);
  for (const bad of ['<script>', 'a"b', '-start', 'x'.repeat(81)]) assert.throws(() => trackingNumber(bad));
  assert.equal(trackingNumber(''), null);
});
