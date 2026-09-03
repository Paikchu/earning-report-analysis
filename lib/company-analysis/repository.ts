import {
  normalizeCompanyAnalysisPublication,
  type CompanyAnalysisPublication,
  type CompanyAnalysisRunStatus,
} from "./contracts.ts";

export type CompanyAnalysisD1Statement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type CompanyAnalysisD1Database = {
  prepare(sql: string): { bind(...values: unknown[]): CompanyAnalysisD1Statement };
  batch(statements: CompanyAnalysisD1Statement[]): Promise<unknown[]>;
};

export type CompanyAnalysisRunUpdate = {
  analysisId: string;
  ticker: string;
  triggerRef: string;
  periodId: string;
  inputHash?: string;
  memoryVersion: number;
  fundamentalsDataVersion?: string;
  status: CompanyAnalysisRunStatus;
  coverageStatus?: "complete" | "partial";
  modelVersion: string;
  promptVersion: string;
  errorCode?: string;
  errorDetail?: string;
  updatedAt: string;
};

export type CompanyAnalysisBackfillCandidate = {
  ticker: string;
  memoryJobId: string;
  memoryVersion: number;
  periodId: string;
  reportDate: string;
  triggerRef: string;
};

type PublicationRow = {
  analysisId: string;
  ticker: string;
  triggerRef: string;
  periodId: string;
  periodEnd: string;
  reportLabel: string;
  inputHash: string;
  memoryVersion: number;
  fundamentalsDataVersion: string;
  status: "ready";
  coverageStatus: "complete" | "partial";
  overviewJson: string;
  modelVersion: string;
  promptVersion: string;
  generatedAt: string;
};

export class D1CompanyAnalysisRepository {
  private readonly database: CompanyAnalysisD1Database;

  constructor(database: CompanyAnalysisD1Database) {
    this.database = database;
  }

  async getLatestPublication(ticker: string): Promise<CompanyAnalysisPublication | null> {
    const row = await this.database.prepare(`${publicationSelect()}
      WHERE ticker = ? AND status = 'ready'
      ORDER BY generated_at DESC, analysis_id DESC
      LIMIT 1
    `).bind(ticker).first<PublicationRow>();
    return row ? publicationFromRow(row) : null;
  }

  async getPublication(ticker: string, analysisId: string): Promise<CompanyAnalysisPublication | null> {
    const row = await this.database.prepare(`${publicationSelect()}
      WHERE ticker = ? AND analysis_id = ? AND status = 'ready'
      LIMIT 1
    `).bind(ticker, analysisId).first<PublicationRow>();
    return row ? publicationFromRow(row) : null;
  }

  async hasNewerActiveRun(ticker: string, generatedAt: string): Promise<boolean> {
    const row = await this.database.prepare(`
      SELECT analysis_id AS analysisId
      FROM company_analysis_runs
      WHERE ticker = ? AND status IN ('waiting_fundamentals', 'calculating', 'analyzing', 'validating')
        AND updated_at > ?
      LIMIT 1
    `).bind(ticker, generatedAt).first<{ analysisId: string }>();
    return Boolean(row);
  }

  async listBackfillCandidates(tickers: string[], limit = 100, includeIncomplete = false): Promise<CompanyAnalysisBackfillCandidate[]> {
    const allowed = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
    if (!allowed.length) return [];
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const placeholders = allowed.map(() => "?").join(", ");
    const rows = await this.database.prepare(`
      WITH ranked_memory AS (
        SELECT j.job_id AS memoryJobId, j.ticker, j.period_id AS periodId,
          p.end_date AS reportDate,
          ROW_NUMBER() OVER (
            PARTITION BY j.ticker
            ORDER BY p.end_date DESC, j.completed_at DESC, j.job_id DESC
          ) AS memoryRank
        FROM sec_memory_jobs j
        JOIN sec_periods p ON p.period_id = j.period_id AND p.ticker = j.ticker
        WHERE j.status = 'complete' AND j.ticker IN (${placeholders})
      )
      SELECT m.ticker, m.memoryJobId, t.version AS memoryVersion,
        m.periodId, m.reportDate
      FROM ranked_memory m
      JOIN sec_company_memory_threads t ON t.ticker = m.ticker
      WHERE m.memoryRank = 1
        AND NOT EXISTS (
          SELECT 1 FROM company_analysis_runs r
          WHERE ${includeIncomplete
            ? "r.ticker = m.ticker AND r.period_id = m.periodId AND r.memory_version = t.version AND r.status = 'ready'"
            : "r.trigger_ref = m.memoryJobId || ':' || CAST(t.version AS TEXT)"}
        )
      ORDER BY m.ticker
      LIMIT ?
    `).bind(...allowed, boundedLimit).all<Omit<CompanyAnalysisBackfillCandidate, "triggerRef">>();
    return rows.results.map((row) => ({
      ...row,
      triggerRef: `${row.memoryJobId}:${row.memoryVersion}`,
    }));
  }

  async upsertRun(update: CompanyAnalysisRunUpdate): Promise<void> {
    await this.database.prepare(`
      INSERT INTO company_analysis_runs (
        analysis_id, ticker, trigger_ref, period_id, input_hash, memory_version,
        fundamentals_data_version, status, coverage_status, model_version,
        prompt_version, error_code, error_detail, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(analysis_id) DO UPDATE SET
        input_hash = COALESCE(excluded.input_hash, company_analysis_runs.input_hash),
        fundamentals_data_version = COALESCE(excluded.fundamentals_data_version, company_analysis_runs.fundamentals_data_version),
        status = excluded.status,
        coverage_status = COALESCE(excluded.coverage_status, company_analysis_runs.coverage_status),
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        updated_at = excluded.updated_at
    `).bind(
      update.analysisId,
      update.ticker,
      update.triggerRef,
      update.periodId,
      update.inputHash ?? null,
      update.memoryVersion,
      update.fundamentalsDataVersion ?? null,
      update.status,
      update.coverageStatus ?? null,
      update.modelVersion,
      update.promptVersion,
      update.errorCode ?? null,
      update.errorDetail?.slice(0, 1_000) ?? null,
      update.updatedAt,
    ).run();
  }

  async publish(publicationInput: unknown): Promise<{ duplicate: boolean; publication: CompanyAnalysisPublication }> {
    const publication = normalizeCompanyAnalysisPublication(publicationInput);
    const existing = await this.getPublication(publication.ticker, publication.analysisId);
    if (existing) {
      if (existing.inputHash !== publication.inputHash) {
        throw new Error("Published company analysis is immutable.");
      }
      return { duplicate: true, publication: existing };
    }
    await this.database.prepare(`
      INSERT INTO company_analysis_runs (
        analysis_id, ticker, trigger_ref, period_id, period_end, report_label,
        input_hash, memory_version, fundamentals_data_version, status,
        coverage_status, overview_json, model_version, prompt_version,
        generated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(analysis_id) DO UPDATE SET
        period_end = excluded.period_end,
        report_label = excluded.report_label,
        input_hash = excluded.input_hash,
        fundamentals_data_version = excluded.fundamentals_data_version,
        status = excluded.status,
        coverage_status = excluded.coverage_status,
        overview_json = excluded.overview_json,
        model_version = excluded.model_version,
        prompt_version = excluded.prompt_version,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
      WHERE company_analysis_runs.status <> 'ready'
    `).bind(
      publication.analysisId,
      publication.ticker,
      publication.triggerRef,
      publication.periodId,
      publication.periodEnd,
      publication.reportLabel,
      publication.inputHash,
      publication.memoryVersion,
      publication.fundamentalsDataVersion,
      publication.coverageStatus,
      JSON.stringify(publication.overview),
      publication.modelVersion,
      publication.promptVersion,
      publication.generatedAt,
      publication.generatedAt,
    ).run();
    const stored = await this.getPublication(publication.ticker, publication.analysisId);
    if (!stored) throw new Error("Company analysis publication was not committed.");
    if (stored.inputHash !== publication.inputHash) {
      throw new Error("Published company analysis is immutable.");
    }
    return { duplicate: false, publication: stored };
  }
}

function publicationSelect(): string {
  return `
    SELECT analysis_id AS analysisId, ticker, trigger_ref AS triggerRef,
      period_id AS periodId, period_end AS periodEnd, report_label AS reportLabel,
      input_hash AS inputHash, memory_version AS memoryVersion,
      fundamentals_data_version AS fundamentalsDataVersion, status,
      coverage_status AS coverageStatus, overview_json AS overviewJson,
      model_version AS modelVersion, prompt_version AS promptVersion,
      generated_at AS generatedAt
    FROM company_analysis_runs
  `;
}

function publicationFromRow(row: PublicationRow): CompanyAnalysisPublication {
  return normalizeCompanyAnalysisPublication({
    schemaVersion: "company-analysis.v1",
    ...row,
    overview: JSON.parse(row.overviewJson),
  });
}
