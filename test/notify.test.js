import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.LOG_SILENT = 'true';
const { config } = await import('../lib/config.js');
const { sendDispatchNotification, sendOtpEmail } = await import('../lib/notify.js');

const realFetch = globalThis.fetch;
const realKey = config.email.resendApiKey;
let calls;

function stubFetch(status, body = '{}') {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, payload: JSON.parse(init.body) });
    return new Response(body, { status });
  };
}

beforeEach(() => {
  calls = [];
  config.email.resendApiKey = 're_test_stub';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.email.resendApiKey = realKey;
});

test('dispatch email goes to Resend with the configured sender and tracking details', async () => {
  stubFetch(200);
  const out = await sendDispatchNotification({ email: 'buyer@test.local', name: 'Asha', orderId: 'abcdef12-0000', courier: 'Delhivery', trackingNumber: 'VS-1', trackingUrl: 'https://track.example/VS-1' });
  assert.deepEqual(out, { delivered: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_stub');
  assert.equal(calls[0].payload.from, config.email.from);
  assert.deepEqual(calls[0].payload.to, ['buyer@test.local']);
  assert.match(calls[0].payload.subject, /ABCDEF12 is on its way/);
  assert.match(calls[0].payload.text, /Tracking number: VS-1/);
});

test('a provider rejection on dispatch is reported, never thrown', async () => {
  stubFetch(422, '{"message":"domain not verified"}');
  const out = await sendDispatchNotification({ email: 'buyer@test.local', orderId: 'abcdef12', pickup: true });
  assert.deepEqual(out, { delivered: false, reason: 'provider_error' });
});

test('no customer email or no provider: nothing is sent', async () => {
  stubFetch(200);
  assert.deepEqual(await sendDispatchNotification({ email: null, orderId: 'x' }), { delivered: false, reason: 'no_email' });
  config.email.resendApiKey = '';
  assert.equal((await sendDispatchNotification({ email: 'a@test.local', orderId: 'x' })).reason, 'no_provider');
  assert.equal(calls.length, 0);
});

test('a failed sign-in code email surfaces as 502 so the customer can retry', async () => {
  stubFetch(500);
  await assert.rejects(sendOtpEmail('a@test.local', '123456'), (err) => err.status === 502 && err.code === 'otp_delivery_failed');
  assert.match(calls[0].payload.text, /123456/);
});
