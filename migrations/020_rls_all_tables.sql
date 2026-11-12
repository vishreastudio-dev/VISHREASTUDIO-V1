-- Hosted Postgres (Supabase) lockdown for every table, including those created after migration 013
-- (membership periods, rewards, gifts, billing, Wardrobe Bag, notifications). Migration 013 enabled
-- RLS only on the tables that existed then; later tables relied on the hosting platform's defaults.
-- The browser never talks to the database; the Express server connects as the table owner and is
-- unaffected. Skipped where the Supabase roles do not exist (plain PostgreSQL, CI).
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
