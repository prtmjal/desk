import { index, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { tenantId } from "./tenants";

/** Global (not tenant-scoped): a person may belong to several tenants. No RLS. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** External identity (Clerk / Auth.js) subject. */
  authSubject: text("auth_subject").unique(),
  ...timestamps(),
});

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member", "viewer"]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    ...timestamps(),
  },
  (t) => [
    index("memberships_tenant_idx").on(t.tenantId, t.userId),
    unique("memberships_tenant_user_uq").on(t.tenantId, t.userId),
  ],
);
