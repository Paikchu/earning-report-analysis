import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const secCache = sqliteTable("sec_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const secFilingSummaries = sqliteTable("sec_filing_summaries", {
  ticker: text("ticker").notNull(),
  accessionNumber: text("accession_number").notNull(),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  payload: text("payload").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ticker, table.accessionNumber] }),
]);
