import { config } from '../lib/config.js';
import { getSupabaseAdmin } from '../lib/supabase.js';

async function check() {
  console.log('SUPABASE_CONFIG:');
  console.log('URL:', config.supabase.url);
  console.log('HAS_ANON_KEY:', Boolean(config.supabase.anonKey));
  console.log('HAS_SERVICE_ROLE_KEY:', Boolean(config.supabase.serviceRoleKey));
  console.log('IS_CONFIGURED:', config.supabase.isConfigured);

  const client = getSupabaseAdmin();
  if (!client) {
    console.log('No Supabase Admin client available');
    process.exit(1);
  }

  try {
    // List users using admin API if service role key is available
    const { data, error } = await client.auth.admin.listUsers();
    if (error) {
      console.log('Admin listUsers error:', error.message);
    } else {
      console.log('Supabase Auth Users count:', data.users?.length);
      console.log('Users in Supabase Auth:', data.users?.map(u => ({ id: u.id, email: u.email, confirmed_at: u.email_confirmed_at })));
    }
  } catch (err) {
    console.log('Admin API call threw:', err.message);
  }

  process.exit(0);
}

check();
