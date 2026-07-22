import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const holdingPlans = sqliteTable("holding_plans", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  holdingReason: text("holding_reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("holding_plans_owner_ticker_idx").on(table.ownerEmail, table.ticker)]);

export const planLevels = sqliteTable("plan_levels", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => holdingPlans.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["add", "reduce", "stop", "target"] }).notNull(),
  priceCents: integer("price_cents").notNull(),
  sizeNote: text("size_note").notNull().default(""),
  triggerNote: text("trigger_note").notNull().default(""),
  sortOrder: integer("sort_order").notNull(),
});
