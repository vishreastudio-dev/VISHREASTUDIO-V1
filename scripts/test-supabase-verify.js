import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.argv[2];
const token = process.argv[3];

if (!email || !token) {
  console.log('Usage: node scripts/test-supabase-verify.js <email> <6-digit-code>');
  process.exit(1);
}

console.log('====================================================');
console.log('  VISHREA STUDIO — Live Supabase OTP Verification');
console.log('====================================================');
console.log(`Verifying OTP for: ${email}`);
console.log(`Code: ${token}\n`);

const supabase = createClient(url, anonKey);

async function run() {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });

  if (error || !data?.session) {
    console.error('❌ Verification Failed:', error?.message || 'No session returned');
    process.exit(1);
  }

  console.log('✅ Supabase Auth verified the OTP successfully!');
  console.log('User Supabase ID:', data.user.id);
  console.log('Access Token Length:', data.session.access_token.length);
  console.log('\nSession is ready for exchange with Express backend /api/auth/session-exchange.');
}

run();
