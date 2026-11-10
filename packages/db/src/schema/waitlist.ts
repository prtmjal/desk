import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./common.js";

/** Marketing-site waitlist. Not tenant scoped, no RLS (written by the public site). */
export const waitlist = pgTable("waitlist", {
  id: id(),
  email: text("email").notNull().unique(),
  company: text("company"),
  erp: text("erp"),
  ordersPerDay: integer("orders_per_day"),
  source: text("source"),
  createdAt: createdAt(),
});
