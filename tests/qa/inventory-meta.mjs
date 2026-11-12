// Prints each mounted module's declared access, methods and per-user write limit. Run only through
// the QA environment: node tests/qa/inventory-meta.mjs (it re-spawns itself with qaEnv()).
import { spawnSync } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';
import { qaEnv, ROOT } from './qa-env.mjs';

if (process.env.SITE_ENV !== 'qa') {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/qa/inventory-meta.mjs')], { cwd: ROOT, env: qaEnv('security'), encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

const modules = [
  ['/api/account', 'api/account.js'], ['/api/cart', 'api/cart.js'], ['/api/catalogue', 'api/catalogue.js'], ['/api/checkout', 'api/checkout.js'],
  ['/api/colour-review', 'api/colour-review.js'], ['/api/content', 'api/content.js'], ['/api/exchange', 'api/exchange.js'], ['/api/gifting', 'api/gifting.js'],
  ['/api/homepage-carousel', 'api/homepage-carousel.js'], ['/api/legal', 'api/legal.js'], ['/api/membership', 'api/membership.js'], ['/api/orders', 'api/orders.js'],
  ['/api/payment-config', 'api/payment-config.js'], ['/api/payment-verify', 'api/payment-verify.js'], ['/api/product', 'api/product.js'], ['/api/referrals', 'api/referrals.js'],
  ['/api/wardrobe', 'api/wardrobe.js'], ['/api/admin/listing-studio', 'api/admin/listing-studio.js'], ['/api/admin/ops', 'api/admin/ops.js'], ['/api/admin/homepage-carousel', 'api/admin/homepage-carousel.js'],
];
const out = [];
for (const [route, file] of modules) {
  const m = await import(pathToFileURL(path.join(ROOT, file)).href);
  out.push({ route, access: m.access || 'public', methods: m.methods || ['GET'], perUserWriteLimit: m.rateLimitPerUser || null });
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
