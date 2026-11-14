import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertNotProductionTarget, config, isAllowedOrigin } from './lib/config.js';
import { adminAllowlist, auth } from './lib/auth.js';
import { db, pool } from './lib/db.js';
import { log } from './lib/log.js';
import { errorHandler, h, httpsRedirect, originGuard, requestId, securityHeaders, sendError } from './lib/http.js';
import { rateLimit } from './lib/rate-limit.js';
import { invalidatePublicCache } from './lib/public-cache.js';
import { sweepExpiredOrders } from './lib/inventory.js';
import { reconcilePayments } from './lib/payments.js';
import { runMembershipLifecycle } from './lib/membership.js';
import { runBillingJobs } from './lib/billing.js';
import { expireBagShipments } from './lib/bag.js';
import { cleanOrphanUploads, UPLOAD_DIR } from './lib/uploads.js';
import { isServableUpload, openLocalSigned } from './lib/storage.js';
import { loadTemplate, pageMeta, renderHtml, sitemapEntries } from './lib/seo.js';
import authRouter from './api/auth.js';
import uploadRouter from './api/upload.js';
import razorpayWebhook from './api/webhooks/razorpay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Domain modules, all in-process. Each exports { default handler, access, methods, rateLimitPerUser? }.
const API_MODULES = [
  ['/api/account', './api/account.js'],
  ['/api/cart', './api/cart.js'],
  ['/api/catalogue', './api/catalogue.js'],
  ['/api/checkout', './api/checkout.js'],
  ['/api/colour-review', './api/colour-review.js'],
  ['/api/content', './api/content.js'],
  ['/api/exchange', './api/exchange.js'],
  ['/api/gifting', './api/gifting.js'],
  ['/api/homepage-carousel', './api/homepage-carousel.js'],
  ['/api/legal', './api/legal.js'],
  ['/api/membership', './api/membership.js'],
  ['/api/orders', './api/orders.js'],
  ['/api/payment-config', './api/payment-config.js'],
  ['/api/payment-verify', './api/payment-verify.js'],
  ['/api/product', './api/product.js'],
  ['/api/referrals', './api/referrals.js'],
  ['/api/search', './api/search.js'],
  ['/api/size-profiles', './api/size-profiles.js'],
  ['/api/wardrobe', './api/wardrobe.js'],
  ['/api/admin/ops', './api/admin/ops.js'],
  ['/api/admin/homepage-carousel', './api/admin/homepage-carousel.js'],
  ['/api/admin/ai-studio', './api/admin/ai-studio.js'],
  ['/api/style-assistant', './api/style-assistant.js'],
];

async function mountModule(app, routePath, file) {
  const mod = await import(pathToFileURL(path.join(__dirname, file)).href);
  const handler = mod.default;
  const access = mod.access || 'public';
  const methods = mod.methods || ['GET'];
  const perUser = mod.rateLimitPerUser
    ? rateLimit({ name: `mod:${routePath}`, ...mod.rateLimitPerUser, key: (req) => req.user?.id || req.ip, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] })
    : (req, res, next) => next();

  app.all(
    routePath,
    (req, res, next) => {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
      }
      if (access !== 'public' && !req.user) return sendError(res, 401, 'unauthorized', 'Please sign in to continue');
      if (access === 'admin' && !req.user.is_admin) {
        log.warn('security.admin_denied', { user: req.user.id, path: req.path });
        return sendError(res, 403, 'forbidden', 'Admin access is required');
      }
      next();
    },
    perUser,
    h(handler)
  );
}

function sitemapXml(entries) {
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
  const urls = entries.map((e) => {
    const lastmod = e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    const images = (e.images || []).map((src) => `<image:image><image:loc>${esc(src)}</image:loc></image:image>`).join('');
    return `  <url><loc>${esc(e.loc)}</loc>${lastmod}${images}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>`;
}

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(httpsRedirect);
  app.use(securityHeaders);
  // Same-origin by default. Additional origins only when explicitly configured or in dev tunnel.
  app.use('/api', cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ name: 'api_global', windowMs: 60_000, max: Number(process.env.RATE_LIMIT_GLOBAL || 600), key: (req) => req.ip }));

  // Webhook needs the raw body for signature verification; mount before any JSON parser.
  app.use('/api/webhooks', razorpayWebhook);

  app.use(originGuard);
  app.use(
    h(async (req, res, next) => {
      try {
        req.user = req.path.startsWith('/api/') ? await auth.extractUser(req) : null;
      } catch (err) {
        log.warn('auth.session_lookup_failed', { message: err.message });
        req.user = null;
      }
      next();
    })
  );

  // Admin writes (products, stock, prices, drops, content, settings) clear cached public responses.
  app.use('/api/admin', (req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => res.statusCode < 400 && invalidatePublicCache());
    next();
  });
  app.use('/api/upload', uploadRouter);
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', h(async (req, res) => {
    const dbOk = await db.healthy();
    // Pool and process figures help load tests and monitoring; production shows them to admins only.
    const cpu = process.cpuUsage();
    const poolStats = !config.isProd || req.user?.is_admin
      ? {
          pool: { max: pool.options.max, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
          process: { rss_mb: Math.round(process.memoryUsage().rss / 1048576), heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576), cpu_ms: Math.round((cpu.user + cpu.system) / 1000), uptime_s: Math.round(process.uptime()) },
        }
      : {};
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk ? 'up' : 'down', time: new Date().toISOString(), ...poolStats });
  }));
  app.use('/api/auth', authRouter);
  for (const [route, file] of API_MODULES) await mountModule(app, route, file);
  // Local store only: a signed, expiring link to a private file (Supabase serves its own signed URLs).
  app.get('/api/media/signed', h(async (req, res) => {
    const opened = await openLocalSigned({ ref: String(req.query.ref || ''), exp: req.query.exp, sig: String(req.query.sig || '') });
    if (!opened) return sendError(res, 404, 'not_found', 'This link has expired or is not valid');
    res.setHeader('Content-Type', opened.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.sendFile(opened.file, { dotfiles: 'allow' });
  }));
  app.use('/api', (req, res) => sendError(res, 404, 'not_found', 'API route not found'));

  // User uploads: only files still in use (see isServableUpload), served with a sandboxing CSP and
  // nosniff so a file can never execute as a page.
  app.use(
    '/uploads',
    h(async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || !(await isServableUpload(req.path.slice(1)))) return sendError(res, 404, 'not_found', 'File not found');
      next();
    }),
    express.static(UPLOAD_DIR, {
      dotfiles: 'deny',
      index: false,
      maxAge: '30d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      },
    })
  );
  // Editorial images and icons are not fingerprinted: a day of caching, then ETag revalidation.
  app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny', maxAge: '1d' }));

  const reactDistPath = path.join(__dirname, 'vishrea-react', 'dist');
  // Precompressed copies written at build time (scripts/precompress.js); names are content hashes.
  const precompressed = new Map();
  app.get('/assets/:file', (req, res, next) => {
    const name = path.basename(req.params.file);
    if (!/\.(js|css|wasm)$/.test(name)) return next();
    const accepts = String(req.headers['accept-encoding'] || '');
    for (const [encoding, ext] of [['br', '.br'], ['gzip', '.gz']]) {
      if (!new RegExp(`\\b${encoding}\\b(?!;q=0(\\.0*)?\\b)`).test(accepts)) continue;
      const file = path.join(reactDistPath, 'assets', name + ext);
      if (!precompressed.has(file)) precompressed.set(file, fs.existsSync(file));
      if (!precompressed.get(file)) continue;
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type(path.extname(name));
      return res.sendFile(file, (err) => {
        if (err) {
          precompressed.set(file, false);
          if (!res.headersSent) next();
        }
      });
    }
    next();
  });
  app.use(express.static(reactDistPath, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/[\\/]assets[\\/]/.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));

  app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
  app.get(['/coming-soon', '/coming-soon/*'], (req, res) => res.redirect(301, '/'));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    if (!config.isProd && process.env.SITE_ENV !== 'production') return res.send('User-agent: *\nDisallow: /\n');
    const disallow = ['/api/', '/admin', '/account', '/cart', '/checkout', '/orders', '/login'].map((p) => `Disallow: ${p}`).join('\n');
    res.send(`User-agent: *\nAllow: /\n${disallow}\n\nSitemap: ${config.publicSiteUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', h(async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml(await sitemapEntries()));
  }));

  // SPA routes: the React app plus server-rendered metadata, structured data and status code.
  app.get('*', h(async (req, res, next) => {
    if (path.extname(req.path)) return next();
    const index = path.join(reactDistPath, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('Storefront build not found. Run `npm run build`, or use the Vite dev server.');
    try {
      const meta = await pageMeta(req);
      if (meta.redirect) return res.redirect(301, meta.redirect);
      for (const [k, v] of Object.entries(meta.headers || {})) res.setHeader(k, v);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(meta.status).type('html').send(renderHtml(loadTemplate(index), meta));
    } catch (err) {
      log.warn('seo.pageMeta_failed', { path: req.path, error: err.message });
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).type('html').sendFile(index);
    }
  }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  app.use(errorHandler);
  return app;
}

// One instance at a time runs the background jobs. A session-level advisory lock needs a session-mode
// connection (direct Postgres or a session pooler, not a transaction pooler).
const JOBS_LOCK_KEY = 704_210_021;

export function startBackgroundJobs() {
  if (process.env.RUN_BACKGROUND_JOBS === 'false') return null;
  let running = false;
  const tick = async () => {
    if (running) return; // a slow gateway must not stack overlapping passes
    running = true;
    let lock = null;
    try {
      lock = await pool.connect();
      if (!(await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [JOBS_LOCK_KEY])).rows[0].ok) return;
      try {
        await sweepExpiredOrders().catch((err) => log.error('jobs.sweep_failed', { message: err.message }));
        await reconcilePayments().catch((err) => log.error('jobs.reconcile_failed', { message: err.message }));
        await runMembershipLifecycle().catch((err) => log.error('jobs.membership_failed', { message: err.message }));
        await runBillingJobs().catch((err) => log.error('jobs.billing_failed', { message: err.message }));
        await expireBagShipments().catch((err) => log.error('jobs.bag_expiry_failed', { message: err.message }));
        await cleanOrphanUploads().catch((err) => log.error('jobs.upload_cleanup_failed', { message: err.message }));
      } finally {
        await lock.query('SELECT pg_advisory_unlock($1)', [JOBS_LOCK_KEY]).catch(() => {});
      }
    } catch (err) {
      log.error('jobs.lock_failed', { message: err.message });
    } finally {
      lock?.release();
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return timer;
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (isMain) {
  assertNotProductionTarget('Server start', { script: false });
  const app = await createApp();
  const server = app.listen(config.port, () => {
    log.info('server.started', { port: config.port, mode: config.isProd ? 'production' : 'development', razorpay: config.razorpay.configured, membership_plan: Boolean(config.razorpay.membershipPlanId), email: Boolean(config.email.resendApiKey), origins: config.allowedOrigins });
    if (config.isProd && !config.email.resendApiKey) log.warn('server.email_unconfigured', { effect: 'sign-in codes and dispatch emails cannot be sent' });
    if (config.isProd && !adminAllowlist()) log.warn('server.admin_allowlist_unset', { effect: 'every account with an admin role in the database has admin access; set ADMIN_ALLOWED_EMAILS to the owner-approved list' });
  });
  startBackgroundJobs();
  const shutdown = (signal) => {
    log.info('server.shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (err) => log.error('process.unhandled_rejection', { message: err?.message }));
}
