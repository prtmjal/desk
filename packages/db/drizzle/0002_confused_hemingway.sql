CREATE TABLE "tenant_routes" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "tenant_routes_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_tenant_ref_uq" UNIQUE("tenant_id","ref")
);
--> statement-breakpoint
DROP INDEX "orders_tenant_customer_po_uq";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_available" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "source" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "cost_usd" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "erp_order_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "erp_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "auto_posted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "touchless" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shadow_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "post_error" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_routes" ADD CONSTRAINT "tenant_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_routes_tenant_idx" ON "tenant_routes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_customer_po_uq" ON "orders" USING btree ("tenant_id","customer_id","po_number") WHERE "orders"."status" IN ('confirmed', 'posted') AND "orders"."po_number" IS NOT NULL AND "orders"."customer_id" IS NOT NULL;--> statement-breakpoint
-- Hand-written tail: grants + RLS for the tables added above.
-- tenant_routes is a global identifier lookup read before a tenant context exists (no RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_routes", "secrets" TO app_user;
--> statement-breakpoint
ALTER TABLE "secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "secrets_tenant_isolation" ON "secrets"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
