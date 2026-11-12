# Development Supabase project: setup

**Goal:** local development never reads or writes the live site. You create a separate Supabase
project for development, point your local `.env` at it, and switch on the production guard.

**Secrets:** keys and passwords go only into your local `.env`, which is git-ignored. Never paste them
into chat, tickets, docs or any committed file.

## 1. Create the project (Supabase dashboard)

1. **New project** in the same organisation, for example `vishrea-dev`, in the same region as
   production.
2. Choose a **new** database password. Never reuse the production one.
3. Wait until the project is ready.

## 2. Collect the values

Copy each value straight into your local `.env`:

| `.env` variable | Where in the dashboard |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL (`https://<dev-ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key (server-side only) |
| `DATABASE_URL` | Project Settings → Database → Connection string → URI (fill in the dev password) |

## 3. Edit your local `.env`

Start from `.env.development.example`, option B, or change your current `.env` like this:

```dotenv
NODE_ENV=development

# The LIVE project's ref (public). Arms the guard: the local server refuses to start against it.
PRODUCTION_SUPABASE_PROJECT_REF=<live-ref>

DATABASE_URL=postgresql://postgres:<dev-db-password>@db.<dev-ref>.supabase.co:5432/postgres
DATABASE_SSL=true
ALLOW_REMOTE_DATABASE=true

STORAGE_DRIVER=supabase
SUPABASE_URL=https://<dev-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<dev service_role key>

# Development must not send real email or take real payments.
RESEND_API_KEY=
RAZORPAY_KEY_ID=<rzp_test_... key>
RAZORPAY_KEY_SECRET=<test secret>
JWT_SECRET=<new random value; never the production one>
```

- `<live-ref>` is the part before `.supabase.co` in your current (live) `SUPABASE_URL`. It is not a
  secret: it already appears in every product image URL.
- Also remove the unused `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` lines from
  `vishrea-react/.env`.

## 4. Build the dev project

Run these once:

```powershell
node scripts/check-environment.js        # must end with "RESULT: OK"
npm run migrate                          # schema in the DEV database
npm run migrate -- --seed-demo           # optional demo catalogue
npm run storage:setup -- --fix           # the six buckets in the DEV project
npm run dev
```

If `check-environment` says the configuration "points at production", stop: one of the URLs is still
the live project. The server refuses to start in that state.

## 5. Acting on production deliberately

Use this only after approval, from a terminal where you mean it:
- Maintenance scripts accept `--production` for one run, for example
  `npm run media:rollback -- --results=… --production`.
- They print a `[production]` warning first.
- The web server has no such override.

## 6. What protects you

| Situation | Result |
|---|---|
| Local server started with live `DATABASE_URL` or `SUPABASE_URL` while the guard is armed | refuses to start (no override; `ALLOW_REMOTE_DATABASE` does not bypass it) |
| `migrate`, `storage:setup --fix`, `media:migrate`, `media:rollback`, `media:orphans --delete` against live | refused unless `--production` is passed |
| Production server with a `SUPABASE_URL` from another project | refuses to start |
| QA / load-test stack (`tests/qa/stack.mjs`) | builds its environment from scratch, local only; verified by `node tests/qa/stack.mjs verify` |
