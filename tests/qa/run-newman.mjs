#!/usr/bin/env node
// Runs the Postman collection with Newman against the isolated QA stack only.
//   node tests/qa/run-newman.mjs functional | security
// Newman is installed into scratch/tools/newman (not the app's package.json). QA-only secrets and
// crafted tokens are generated in memory and passed with --env-var; nothing secret is written to disk.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { QA_PORT, ROOT, STATE_DIR } from './qa-env.mjs';

const mode = process.argv[2] || 'functional';
const FOLDERS = {
  functional: ['00 Setup', '01 Authentication', '02 Customer', '03 Catalogue', '04 Product Details', '05 Search and Filters', '06 Shopping Bag', '07 Checkout', '08 Razorpay', '09 Membership', '10 Credits and Rewards', '11 Referrals', '12 Gift Memberships', '13 Orders', '14 Exchanges', '15 Media Uploads', '16 Colour Analysis', '17 Admin', '19 Error Handling'],
  security: ['00 Setup', '18 Security'],
};
if (!FOLDERS[mode]) throw new Error('mode must be functional or security');

// Refuse anything but the isolated stack.
const stack = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'stack.json'), 'utf8'));
const health = await (await fetch(`http://127.0.0.1:${QA_PORT}/api/health`)).json();
if (!health.ok) throw new Error('QA stack is not healthy');

const NEWMAN_DIR = path.join(ROOT, 'scratch', 'tools', 'newman');
const bin = path.join(NEWMAN_DIR, 'node_modules', 'newman', 'bin', 'newman.js');
if (!fs.existsSync(bin)) {
  fs.mkdirSync(NEWMAN_DIR, { recursive: true });
  if (!fs.existsSync(path.join(NEWMAN_DIR, 'package.json'))) fs.writeFileSync(path.join(NEWMAN_DIR, 'package.json'), JSON.stringify({ name: 'qa-newman-tools', private: true }));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Run inside the tools folder: the repository path contains a space.
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund', 'newman@6', 'newman-reporter-htmlextra@1'], { cwd: NEWMAN_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('could not install newman into scratch/tools/newman');
}

const secrets = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'secrets.json'), 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (header, payload, key) => {
  const head = `${b64(header)}.${b64(payload)}`;
  return `${head}.${crypto.createHmac('sha256', key).update(head).digest('base64url')}`;
};
const now = Math.floor(Date.now() / 1000);
const subject = { sub: 'usr_qa_1', email: 'qa-user-1@qa.test' };
const tokens = {
  tokenExpired: sign({ alg: 'HS256', typ: 'JWT' }, { ...subject, iat: now - 7200, exp: now - 3600 }, secrets.jwt),
  tokenWrongSecret: sign({ alg: 'HS256', typ: 'JWT' }, { ...subject, iat: now, exp: now + 3600 }, crypto.randomBytes(32).toString('hex')),
  tokenAlgNone: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...subject, iat: now, exp: now + 3600 })}.`,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(ROOT, 'docs', 'testing', 'newman');
const rawDir = path.join(STATE_DIR, 'raw');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(rawDir, { recursive: true });
const jsonOut = path.join(rawDir, `newman-${mode}-${stamp}.json`);
const htmlOut = path.join(outDir, `newman-${mode}-${stamp}.html`);

const args = [
  bin, 'run', path.join(ROOT, 'postman', 'Vishrea_Studio_API.postman_collection.json'),
  '-e', path.join(ROOT, 'postman', 'Vishrea_Studio_Development.postman_environment.json'),
  ...FOLDERS[mode].flatMap((f) => ['--folder', f]),
  '--env-var', `qaRazorpaySecret=${secrets.razorpaySecret}`,
  '--env-var', `qaWebhookSecret=${secrets.webhookSecret}`,
  ...Object.entries(tokens).flatMap(([k, v]) => ['--env-var', `${k}=${v}`]),
  '--timeout-request', '20000',
  '--reporters', 'cli,json,htmlextra',
  '--reporter-json-export', jsonOut,
  '--reporter-htmlextra-export', htmlOut,
  '--reporter-htmlextra-title', `Vishrea QA — ${mode} (${stamp})`,
  '--reporter-htmlextra-skipSensitiveData',
  '--color', 'off',
];
const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: process.env.APPDATA, USERPROFILE: process.env.USERPROFILE } });
// The JSON export carries run-time variables (including the QA-only secrets passed above): scrub them.
if (fs.existsSync(jsonOut)) {
  let text = fs.readFileSync(jsonOut, 'utf8');
  for (const v of [secrets.razorpaySecret, secrets.webhookSecret, ...Object.values(tokens)]) text = text.split(v).join('<redacted>');
  text = text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '<jwt-redacted>');
  fs.writeFileSync(jsonOut, text);
}
if (fs.existsSync(htmlOut)) {
  let text = fs.readFileSync(htmlOut, 'utf8');
  for (const v of [secrets.razorpaySecret, secrets.webhookSecret, ...Object.values(tokens)]) text = text.split(v).join('<redacted>');
  text = text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '<jwt-redacted>');
  fs.writeFileSync(htmlOut, text);
}
const cli = (r.stdout || '') + (r.stderr || '');
fs.writeFileSync(path.join(rawDir, `newman-${mode}-${stamp}.txt`), cli.split(secrets.razorpaySecret).join('<redacted>').split(secrets.webhookSecret).join('<redacted>'));
const summary = fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf8')).run.stats : null;
console.log(JSON.stringify({ mode, profile: stack.profile, exit: r.status, stats: summary, html: path.relative(ROOT, htmlOut), json: path.relative(ROOT, jsonOut) }, null, 2));
process.exitCode = r.status === 0 ? 0 : 1;
