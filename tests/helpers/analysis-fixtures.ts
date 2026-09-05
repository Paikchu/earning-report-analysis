import type { SqliteD1Database } from "./sqlite-d1.ts";

/**
 * Deterministic fixtures covering the states the contract has to be able to represent: a verified
 * report, a partial one, a summary-only event filing, a filing whose run is still queued, one whose
 * run failed outright, and a company with nothing collected at all.
 *
 * **All of it is synthetic.** Company names, figures, narrative text and hashes are invented for
 * these tests; the tickers are real symbols only because the fundamentals endpoint consults the
 * bundled securities directory to decide whether a company can have fundamentals at all.
 */
export const FIXTURE_TICKER = "MSFT";
/** A real symbol that is deliberately left with no collected data of any kind. */
export const EMPTY_TICKER = "NVDA";
/** A real symbol the directory classifies as an ETF, which cannot have fundamentals. */
export const ETF_TICKER = "QQQ";
/** Never tracked for generation, but historical results exist and must stay readable. */
export const UNTRACKED_TICKER = "AMZN";

export const VERIFIED_ACCESSION = "0000000001-26-000001";
export const PARTIAL_ACCESSION = "0000000001-26-000002";
export const EVENT_ACCESSION = "0000000001-26-000003";
export const QUEUED_ACCESSION = "0000000001-26-000004";
export const FAILED_ACCESSION = "0000000001-26-000005";
export const UNKNOWN_ACCESSION = "0000000009-26-999999";

export const VERIFIED_PERIOD_ID = `${FIXTURE_TICKER}:2026-06-30:annual`;
export const PARTIAL_PERIOD_ID = `${FIXTURE_TICKER}:2026-03-31:quarter`;
export const VERIFIED_REPORT_VERSION = "sec-analysis.v2:aaaa1111";
export const PARTIAL_REPORT_VERSION = "sec-analysis.v2:bbbb2222";

type Row = Record<string, string | number | null>;

export async function seedAnalysisFixtures(database: SqliteD1Database): Promise<void> {
  insertFiling(database, {
    filingId: VERIFIED_ACCESSION,
    accession: VERIFIED_ACCESSION,
    form: "10-K",
    filingDate: "2026-07-30",
    reportDate: "2026-06-30",
  });
  insertFiling(database, {
    filingId: PARTIAL_ACCESSION,
    accession: PARTIAL_ACCESSION,
    form: "10-Q",
    filingDate: "2026-04-25",
    reportDate: "2026-03-31",
  });
  insertFiling(database, {
    filingId: EVENT_ACCESSION,
    accession: EVENT_ACCESSION,
    form: "8-K",
    filingDate: "2026-04-20",
    reportDate: "2026-04-20",
  });
  insertFiling(database, {
    filingId: QUEUED_ACCESSION,
    accession: QUEUED_ACCESSION,
    form: "8-K",
    filingDate: "2026-02-10",
    reportDate: "2026-02-10",
  });
  insertFiling(database, {
    filingId: FAILED_ACCESSION,
    accession: FAILED_ACCESSION,
    form: "8-K",
    filingDate: "2026-01-15",
    reportDate: "2026-01-15",
  });

  insertPeriod(database, VERIFIED_PERIOD_ID, "annual", "2026-06-30");
  insertPeriod(database, PARTIAL_PERIOD_ID, "quarter", "2026-03-31");
  link(database, VERIFIED_ACCESSION, VERIFIED_PERIOD_ID);
  link(database, PARTIAL_ACCESSION, PARTIAL_PERIOD_ID);

  publishReport(database, VERIFIED_PERIOD_ID, VERIFIED_REPORT_VERSION, "verified", verifiedReport());
  publishReport(database, PARTIAL_PERIOD_ID, PARTIAL_REPORT_VERSION, "partial", partialReport());

  putSummary(database, VERIFIED_ACCESSION, summary(VERIFIED_ACCESSION, "10-K", "2026-07-30", { report: "Annual results." }));
  putSummary(database, PARTIAL_ACCESSION, summary(PARTIAL_ACCESSION, "10-Q", "2026-04-25", { report: "Quarterly results." }));
  // An event filing legitimately carries a narrative summary and no structured report.
  putSummary(database, EVENT_ACCESSION, summary(EVENT_ACCESSION, "8-K", "2026-04-20", { eventCategory: "executive" }));

  putJob(database, QUEUED_ACCESSION, "queued", "2026-02-10T10:00:00.000Z", null);
  putJob(database, FAILED_ACCESSION, "failed", "2026-01-16T10:00:00.000Z", "MODEL_RATE_LIMITED");
  putJob(database, VERIFIED_ACCESSION, "complete", "2026-07-31T10:00:00.000Z", null);

  // A company with results but no place on the generation whitelist.
  insertFiling(database, {
    filingId: `${UNTRACKED_TICKER}-0001`,
    ticker: UNTRACKED_TICKER,
    accession: "0000000002-26-000001",
    form: "10-Q",
    filingDate: "2026-05-01",
    reportDate: "2026-03-31",
  });
}

export function seedCompanyAnalysisPublication(
  database: SqliteD1Database,
  overrides: Partial<Row> = {},
): void {
  const row: Row = {
    analysis_id: "company:MSFT:analysis-1",
    ticker: FIXTURE_TICKER,
    trigger_ref: "memory-job-1:3",
    period_id: `${FIXTURE_TICKER}:2026-06-30:quarterly`,
    period_end: "2026-06-30",
    report_label: "FY2026 Q4",
    input_hash: "input-hash-0001",
    memory_version: 3,
    fundamentals_data_version: "fundamentals-hash-0001",
    status: "ready",
    coverage_status: "complete",
    overview_json: JSON.stringify(overviewFixture()),
    model_version: "test-model.v1",
    prompt_version: "company-analysis-skill.v2",
    error_code: null,
    error_detail: null,
    generated_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
  const columns = Object.keys(row);
  database.raw.prepare(
    `INSERT INTO company_analysis_runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => row[column] as never));
}

export function seedCompanyAnalysisRun(
  database: SqliteD1Database,
  values: { analysisId: string; status: string; updatedAt: string; errorCode?: string | null; ticker?: string },
): void {
  database.raw.prepare(`
    INSERT INTO company_analysis_runs (
      analysis_id, ticker, trigger_ref, period_id, memory_version, status,
      model_version, prompt_version, error_code, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.analysisId,
    values.ticker ?? FIXTURE_TICKER,
    `${values.analysisId}:trigger`,
    `${values.ticker ?? FIXTURE_TICKER}:2026-09-30:quarterly`,
    4,
    values.status,
    "test-model.v1",
    "company-analysis-skill.v2",
    values.errorCode ?? null,
    values.updatedAt,
  );
}

export function seedFundamentals(
  database: SqliteD1Database,
  values: { ticker?: string; fetchedAt: string; qualityStatus?: string } = { fetchedAt: "2026-08-28T00:00:00.000Z" },
): void {
  const ticker = values.ticker ?? FIXTURE_TICKER;
  const runId = `run-${ticker}-${values.fetchedAt}`;
  const periodId = `${ticker}:3M:2026-06-30`;
  database.raw.prepare(`
    INSERT INTO fundamental_fetch_runs (
      run_id, ticker, request_hash, parser_version, catalog_version, payload_hash,
      status, quality_status, issue_count, lease_owner, lease_until, started_at, fetched_at, completed_at
    ) VALUES (?, ?, ?, 'yahoo-parser.v1', 'fundamental-metrics.v2', ?, 'success', ?, 0, 'test', ?, ?, ?, ?)
  `).run(
    runId, ticker, `hash-${runId}`, `payload-${runId}`, values.qualityStatus ?? "complete",
    values.fetchedAt, values.fetchedAt, values.fetchedAt, values.fetchedAt,
  );
  database.raw.prepare(`
    INSERT OR IGNORE INTO fundamental_periods (period_id, ticker, period_type, period_end, currency)
    VALUES (?, ?, '3M', '2026-06-30', 'USD')
  `).run(periodId, ticker);
  database.raw.prepare(`
    INSERT INTO fundamental_observations (
      observation_id, period_id, ticker, period_end, metric_key, source_field, value_decimal,
      unit_family, unit, currency, basis, source_run_id, revision
    ) VALUES (?, ?, ?, '2026-06-30', 'total_revenue', 'totalRevenue', '1000000', 'currency', 'USD', 'USD', 'reported', ?, 1)
  `).run(`${periodId}:total_revenue`, periodId, ticker, runId);
}

function insertFiling(database: SqliteD1Database, values: {
  filingId: string;
  ticker?: string;
  accession: string;
  form: string;
  filingDate: string;
  reportDate: string;
}): void {
  database.raw.prepare(`
    INSERT INTO sec_filings (filing_id, ticker, accession_number, cik, form, filing_date, report_date, document_url, index_url)
    VALUES (?, ?, ?, '0000789019', ?, ?, ?, ?, ?)
  `).run(
    values.filingId,
    values.ticker ?? FIXTURE_TICKER,
    values.accession,
    values.form,
    values.filingDate,
    values.reportDate,
    `https://www.sec.gov/Archives/${values.accession}/primary.htm`,
    `https://www.sec.gov/Archives/${values.accession}/index.htm`,
  );
}

function insertPeriod(database: SqliteD1Database, periodId: string, scope: string, endDate: string): void {
  database.raw.prepare(`
    INSERT INTO sec_periods (period_id, ticker, period_scope, end_date) VALUES (?, ?, ?, ?)
  `).run(periodId, FIXTURE_TICKER, scope, endDate);
}

function link(database: SqliteD1Database, filingId: string, periodId: string): void {
  database.raw.prepare(`INSERT INTO sec_filing_periods (filing_id, period_id, role) VALUES (?, ?, 'primary')`)
    .run(filingId, periodId);
}

function publishReport(
  database: SqliteD1Database,
  periodId: string,
  reportVersion: string,
  verificationStatus: string,
  payload: unknown,
  generatedAt = "2026-07-31T00:00:00.000Z",
): void {
  database.raw.prepare(`
    INSERT INTO sec_published_reports (ticker, period_id, report_version, payload, verification_status, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(FIXTURE_TICKER, periodId, reportVersion, JSON.stringify(payload), verificationStatus, generatedAt);
}

function putSummary(database: SqliteD1Database, accession: string, payload: unknown): void {
  database.raw.prepare(`
    INSERT INTO sec_filing_summaries (ticker, accession_number, generated_at, payload) VALUES (?, ?, ?, ?)
  `).run(FIXTURE_TICKER, accession, "2026-07-31T00:00:00.000Z", JSON.stringify(payload));
}

function putJob(database: SqliteD1Database, accession: string, status: string, updatedAt: string, errorCode: string | null): void {
  database.raw.prepare(`
    INSERT INTO sec_analysis_jobs (
      job_id, ticker, accession_number, analysis_version, status, current_stage,
      attempt, error_code, requested_by, workflow_instance_id, updated_at
    ) VALUES (?, ?, ?, 'sec-analysis.v2', ?, 'summary', 1, ?, 'scheduled', ?, ?)
  `).run(`${accession}:job`, FIXTURE_TICKER, accession, status, errorCode, `wf-${accession}`, updatedAt);
}

export function verifiedReport() {
  return {
    ticker: FIXTURE_TICKER,
    periodId: VERIFIED_PERIOD_ID,
    reportVersion: VERIFIED_REPORT_VERSION,
    headline: "Synthetic annual headline",
    keyMetrics: [{
      metricKey: "revenue",
      currentValue: "1,000",
      yoy: "+10%",
      status: "verified",
      evidenceIds: ["ev-1"],
    }],
    changes: { qoq: [], yoy: [], guidance: [], risks: [] },
    dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
  };
}

export function partialReport() {
  return {
    ticker: FIXTURE_TICKER,
    periodId: PARTIAL_PERIOD_ID,
    reportVersion: PARTIAL_REPORT_VERSION,
    headline: "Synthetic quarterly headline",
    keyMetrics: [{
      metricKey: "revenue",
      currentValue: "250",
      status: "derived",
      evidenceIds: ["ev-2"],
    }],
    changes: { qoq: [], yoy: [], guidance: [], risks: [] },
    dataQuality: { coverage: 0.5, verificationStatus: "partial", warnings: ["Synthetic coverage warning."] },
  };
}

function summary(accession: string, form: string, filingDate: string, extra: Record<string, unknown>) {
  return {
    ticker: FIXTURE_TICKER,
    form,
    filingDate,
    accessionNumber: accession,
    headline: "Synthetic summary headline",
    bullets: [{ label: "Synthetic", detail: " bullet.", importance: "high" }],
    analystView: "Synthetic analyst view.",
    source: "deepseek",
    generatedAt: "2026-07-31T00:00:00.000Z",
    ...extra,
  };
}

export function overviewFixture() {
  return {
    label: "Business outlook",
    headline: "Synthetic company headline",
    introduction: "Synthetic introduction for contract tests.",
    highlights: ["01", "02", "03", "04"].map((ordinal, index) => ({
      ordinal,
      title: `Synthetic highlight ${ordinal}`,
      body: "Synthetic highlight body.",
      evidenceRefs: [`evidence-${index + 1}`],
    })),
  };
}
