-- Hand-written migration (drizzle-kit generate --custom).
-- 1. Extensions: pg_trgm (required), pgvector (optional: skipped where unavailable).
-- 2. GIN trigram indexes for the L2 matcher; HNSW index for L3 when pgvector exists.
-- 3. Role app_user (NOLOGIN, NOBYPASSRLS) with table grants; events is append-only.
-- 4. Row-level security ENABLED + FORCED on every tenant-scoped table.
--
-- Policies read the tenant from current_setting('app.tenant_id'). NULLIF guards
-- the '' a GUC reverts to after a transaction that set it locally, so "no context"
-- yields NULL = <uuid> (no rows) instead of a cast error.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available, skipping (%)', SQLERRM;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_description_trgm_idx" ON "items" USING gin ("description" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_sku_trgm_idx" ON "items" USING gin ("sku" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "items_embedding_hnsw_idx" ON "items" USING hnsw ("embedding" vector_cosine_ops)';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
-- The role running migrations (table owner) must be able to SET ROLE app_user.
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'could not grant app_user to %: %', current_user, SQLERRM;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
--> statement-breakpoint
-- Audit log is append-only for the application role (plan §6.4).
REVOKE UPDATE, DELETE ON "events" FROM app_user;
--> statement-breakpoint
-- tenants: a session sees (and may create) only its own tenant row.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenants_isolation" ON "tenants"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Every tenant-scoped table: same policy on tenant_id.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'memberships', 'integrations', 'sync_runs', 'items',
    'price_lists', 'price_list_items', 'customers', 'ship_tos',
    'inbound_messages', 'documents', 'orders', 'order_lines', 'aliases',
    'rules', 'events', 'usage_meters', 'subscriptions', 'invoices'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
