import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const testEmail = process.argv[2] || process.env.DEFAULT_ADMIN_EMAIL || 'vishreastudio.admin@gmail.com';

console.log('====================================================');
console.log('  VISHREA STUDIO — Live Supabase Auth Test Utility');
console.log('====================================================');
console.log(`Supabase URL: ${url}`);
console.log(`Testing Email: ${testEmail}\n`);

if (!url || !anonKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, anonKey);

async function run() {
  console.log(`[1/2] Requesting Email OTP for ${testEmail}...`);
  const { data, error } = await supabase.auth.signInWithOtp({
    email: testEmail.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error('❌ Supabase Auth OTP Request Failed:');
    console.error(error.message);
    if (error.status) console.error(`HTTP Status: ${error.status}`);
    process.exit(1);
  }

  console.log('✅ Supabase Auth accepted the OTP request!');
  console.log('📧 An email containing the 6-digit code has been dispatched to:', testEmail);
  console.log('\n[2/2] To verify your code from the terminal, run:');
  console.log(`node scripts/test-supabase-verify.js ${testEmail} <6-DIGIT-CODE>\n`);
}

run();
