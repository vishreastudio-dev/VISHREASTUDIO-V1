#!/usr/bin/env node
/**
 * Read-only: which database and Supabase project this machine's configuration targets, and whether
 * the production guard is armed. Prints no secrets and connects to nothing.
 *
 *   node scripts/check-environment.js
 */
import { config, isRemoteDatabase, supabaseProjectRef } from '../lib/config.js';

const dbUrl = process.env.DATABASE_URL || '';
let dbHost = '(unset)';
try {
  dbHost = new URL(dbUrl).hostname;
} catch {}
const prodRef = config.productionProject.ref;
const storageRef = supabaseProjectRef(config.storage.supabaseUrl);
const dbIsProd = Boolean(prodRef) && dbUrl.toLowerCase().includes(prodRef);
const same = (ref) => {
  if (!ref) return '(none)';
  if (!prodRef) return 'unknown (guard not armed)';
  return ref === prodRef ? 'PRODUCTION project' : 'not the production project';
};

const lines = [
  ['NODE_ENV', config.isProd ? 'production' : process.env.NODE_ENV || 'development'],
  ['Database host', `${dbHost.replace(/^db\.[a-z0-9]{20}\./, 'db.<ref>.')} (${isRemoteDatabase() ? 'remote' : 'local'})`],
  ['Database targets', prodRef ? (dbIsProd ? 'PRODUCTION project' : 'not the production project') : 'unknown (guard not armed)'],
  ['Storage driver', config.storage.driver],
  ['Storage targets', config.storage.driver === 'supabase' ? same(storageRef) : 'local disk'],
  ['Service-role key', config.storage.serviceRoleKey ? 'set (server-side)' : 'not set'],
  ['Production guard', prodRef ? 'ARMED (PRODUCTION_SUPABASE_PROJECT_REF set)' : 'not armed: set PRODUCTION_SUPABASE_PROJECT_REF'],
  ['Email (Resend)', config.email.resendApiKey ? 'enabled: real emails are sent' : 'disabled (logged only)'],
  ['Razorpay API', new URL(config.razorpay.apiBase).host + (config.razorpay.keyId?.startsWith('rzp_live_') ? ' (LIVE keys)' : config.razorpay.keyId ? ' (test keys)' : ' (no keys)')],
];
for (const [k, v] of lines) console.log(`${k.padEnd(18)} ${v}`);

if (!config.isProd && config.productionProject.targeted.length) {
  console.log(`\nRESULT: this development configuration points at production (${config.productionProject.targeted.join(', ')}). The server will refuse to start.`);
  process.exitCode = 1;
} else if (!config.isProd && !prodRef) {
  console.log('\nRESULT: guard not armed. Add PRODUCTION_SUPABASE_PROJECT_REF=<live ref> so development can never start against production.');
  process.exitCode = 1;
} else {
  console.log('\nRESULT: OK');
}
