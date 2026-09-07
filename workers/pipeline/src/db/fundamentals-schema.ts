import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const fundamentalFetchRuns = sqliteTable("fundamental_fetch_runs", {
  runId: text("run_id").primaryKey(),
  ticker: text("ticker").notNull(),
  source: text("source", { enum: ["yahoo_finance"] }).notNull().default("yahoo_finance"),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  qualityStatus: text("quality_status", { enum: ["pending", "complete", "partial", "rejected"] })
    .notNull()
    .default("pending"),
  requestHash: text("request_hash").notNull(),
  payloadHash: text("payload_hash"),
  parserVersion: text("parser_version").notNull(),
  catalogVersion: text("catalog_version").notNull(),
  issueCount: integer("issue_count").notNull().default(0),
  observationCount: integer("observation_count").notNull().default(0),
  periodCount: integer("period_count").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseUntil: text("lease_until"),
  startedAt: text("started_at").notNull(),
  fetchedAt: text("fetched_at"),
  completedAt: text("completed_at"),
  errorCode: text("error_code"),
  errorDetail: text("error_detail"),
}, (table) => [
  check("fundamental_fetch_runs_source_check", sql`${table.source} = 'yahoo_finance'`),
  check("fundamental_fetch_runs_status_check", sql`${table.status} IN ('running', 'success', 'failed')`),
  check(
    "fundamental_fetch_runs_quality_check",
    sql`${table.qualityStatus} IN ('pending', 'complete', 'partial', 'rejected')`,
  ),
  check(
    "fundamental_fetch_runs_counts_check",
    sql`${table.issueCount} >= 0 AND ${table.observationCount} >= 0 AND ${table.periodCount} >= 0`,
  ),
  uniqueIndex("fundamental_fetch_runs_running_ticker_idx")
    .on(table.ticker)
    .where(sql`${table.status} = 'running'`),
  index("fundamental_fetch_runs_ticker_status_fetched_idx").on(table.ticker, table.status, table.fetchedAt),
]);

export const fundamentalPeriods = sqliteTable("fundamental_periods", {
  periodId: text("period_id").primaryKey(),
  ticker: text("ticker").notNull(),
  source: text("source", { enum: ["yahoo_finance"] }).notNull().default("yahoo_finance"),
  periodType: text("period_type", { enum: ["3M", "FY"] }).notNull(),
  periodEnd: text("period_end").notNull(),
  fiscalYear: integer("fiscal_year"),
  fiscalQuarter: text("fiscal_quarter", { enum: ["Q1", "Q2", "Q3", "Q4"] }),
  currency: text("currency").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("fundamental_periods_source_check", sql`${table.source} = 'yahoo_finance'`),
  check("fundamental_periods_type_check", sql`${table.periodType} IN ('3M', 'FY')`),
  check(
    "fundamental_periods_quarter_check",
    sql`${table.fiscalQuarter} IS NULL OR ${table.fiscalQuarter} IN ('Q1', 'Q2', 'Q3', 'Q4')`,
  ),
  uniqueIndex("fundamental_periods_identity_idx").on(table.ticker, table.periodType, table.periodEnd),
  index("fundamental_periods_ticker_end_idx").on(table.ticker, table.periodEnd),
]);

export const fundamentalObservations = sqliteTable("fundamental_observations", {
  observationId: text("observation_id").primaryKey(),
  periodId: text("period_id").notNull().references(() => fundamentalPeriods.periodId, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  periodEnd: text("period_end").notNull(),
  metricKey: text("metric_key").notNull(),
  sourceField: text("source_field"),
  valueDecimal: text("value_decimal").notNull(),
  unitFamily: text("unit_family", { enum: ["currency", "percent", "per_share", "shares"] }).notNull(),
  unit: text("unit").notNull(),
  currency: text("currency").notNull().default(""),
  basis: text("basis", { enum: ["reported", "derived"] }).notNull(),
  derivationFormula: text("derivation_formula"),
  derivationVersion: text("derivation_version"),
  sourceRunId: text("source_run_id").notNull().references(() => fundamentalFetchRuns.runId, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check(
    "fundamental_observations_unit_family_check",
    sql`${table.unitFamily} IN ('currency', 'percent', 'per_share', 'shares')`,
  ),
  check("fundamental_observations_basis_check", sql`${table.basis} IN ('reported', 'derived')`),
  check("fundamental_observations_revision_check", sql`${table.revision} >= 1`),
  check(
    "fundamental_observations_source_field_check",
    sql`(${table.basis} = 'reported' AND ${table.sourceField} IS NOT NULL) OR (${table.basis} = 'derived' AND ${table.sourceField} IS NULL)`,
  ),
  uniqueIndex("fundamental_observations_identity_idx").on(table.periodId, table.metricKey),
  index("fundamental_observations_chart_read_idx").on(table.ticker, table.metricKey, table.periodEnd),
  index("fundamental_observations_source_run_idx").on(table.sourceRunId),
]);

export const fundamentalObservationRevisions = sqliteTable("fundamental_observation_revisions", {
  revisionId: text("revision_id").primaryKey(),
  observationId: text("observation_id").notNull().references(() => fundamentalObservations.observationId, { onDelete: "cascade" }),
  sourceRunId: text("source_run_id").notNull().references(() => fundamentalFetchRuns.runId, { onDelete: "restrict" }),
  oldValueDecimal: text("old_value_decimal").notNull(),
  newValueDecimal: text("new_value_decimal").notNull(),
  previousRevision: integer("previous_revision").notNull(),
  newRevision: integer("new_revision").notNull(),
  changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("fundamental_revisions_sequence_check", sql`${table.newRevision} = ${table.previousRevision} + 1`),
  uniqueIndex("fundamental_revisions_observation_version_idx").on(table.observationId, table.newRevision),
  index("fundamental_revisions_observation_changed_idx").on(table.observationId, table.changedAt),
]);

export const fundamentalCompanyProfiles = sqliteTable("fundamental_company_profiles", {
  ticker: text("ticker").primaryKey(),
  classification: text("classification").notNull().default("unclassified"),
  featuresJson: text("features_json").notNull().default("{}"),
  profileVersion: text("profile_version").notNull(),
  inputDataHash: text("input_data_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fundamentalChartSpecs = sqliteTable("fundamental_chart_specs", {
  specId: text("spec_id").primaryKey(),
  ticker: text("ticker").notNull(),
  specJson: text("spec_json").notNull(),
  schemaVersion: text("schema_version").notNull(),
  inputDataHash: text("input_data_hash").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: text("status", { enum: ["active", "superseded", "rejected"] }).notNull(),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  supersededAt: text("superseded_at"),
}, (table) => [
  check("fundamental_chart_specs_status_check", sql`${table.status} IN ('active', 'superseded', 'rejected')`),
  uniqueIndex("fundamental_chart_specs_active_ticker_idx")
    .on(table.ticker)
    .where(sql`${table.status} = 'active'`),
  index("fundamental_chart_specs_ticker_status_generated_idx").on(table.ticker, table.status, table.generatedAt),
]);
