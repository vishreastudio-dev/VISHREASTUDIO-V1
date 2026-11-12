import { razorpay } from '../lib/razorpay.js';

export const access = 'public';
export const methods = ['GET'];

// Only the publishable key id is exposed; the key secret never leaves the server.
export default async function paymentConfig(req, res) {
  res.json({ razorpay_key_id: razorpay.keyId || null, configured: razorpay.configured });
}
