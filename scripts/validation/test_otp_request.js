import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, anonKey);

async function testOtp() {
  const testEmail = 'testcust1795334245486@gmail.com';
  console.log('Testing signInWithOtp for test account:', testEmail);
  const { data, error } = await supabase.auth.signInWithOtp({
    email: testEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.log('SUPABASE_OTP_RESPONSE_ERROR:', error.message, error.status);
  } else {
    console.log('SUPABASE_OTP_RESPONSE_SUCCESS:', data);
  }
  process.exit(0);
}

testOtp();
