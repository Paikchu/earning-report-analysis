import type { SecFiling, SecFilingSummary } from "./sec.ts";
import { buildPeriodIdentity, SEC_ANALYSIS_PROMPT_VERSION, SEC_ANALYSIS_SCHEMA_VERSION, type MemoryCandidate, type PriorSnapshotContext, type PublishedSecReport } from "./sec-analysis.ts";
import type { SecAnalysisArtifact, SecAnalysisContext, SecCacheRecord, SecRepository } from "./sec-service.ts";

type D1ResultStatement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): D1ResultStatement;
  };
};

export type SecAnalysisJobUpdate = {
  jobId: string;
  ticker: string;
  accessionNumber: string;
  analysisVersion: string;
  status: "queued" | "running" | "complete" | "failed";
  currentStage: string;
  attempt: number;
  errorCode?: string;
  errorDetail?: string;
  requestedBy: "scheduled" | "manual";
  workflowInstanceId: string;
  updatedAt: string;
  completedAt?: string;
};

export type SecAnalysisJobStatus = SecAnalysisJobUpdate["status"];

export class D1SecRepository implements SecRepository {
  private readonly database: D1Like;

  constructor(database: D1Like) {
    this.database = database;
  }

  async getCache<T>(key: string): Promise<SecCacheRecord<T> | null> {
    const row = await this.database.prepare(`
      SELECT payload, fetched_at AS fetchedAt
      FROM sec_cache
      WHERE cache_key = ?
    `).bind(key).first<{ payload: string; fetchedAt: string }>();
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload) as T, fetchedAt: row.fetchedAt };
    } catch {
      return null;
    }
  }

  async setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_cache (cache_key, payload, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
    `).bind(key, JSON.stringify(payload), fetchedAt).run();
  }

  async getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null> {
    const row = await this.database.prepare(`
      SELECT payload
      FROM sec_filing_summaries
      WHERE ticker = ? AND accession_number = ?
    `).bind(ticker, accessionNumber).first<{ payload: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as SecFilingSummary;
    } catch {
      return null;
    }
  }

  async setSummary(summary: SecFilingSummary): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_filing_summaries (ticker, accession_number, generated_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ticker, accession_number) DO UPDATE SET
        generated_at = excluded.generated_at,
        payload = excluded.payload
    `).bind(summary.ticker, summary.accessionNumber, summary.generatedAt, JSON.stringify(summary)).run();
  }

  async upsertAnalysisJob(job: SecAnalysisJobUpdate): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_analysis_jobs (
        job_id, ticker, accession_number, analysis_version, status, current_stage,
        attempt, error_code, error_detail, requested_by, workflow_instance_id,
        updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        current_stage = excluded.current_stage,
        attempt = excluded.attempt,
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        requested_by = excluded.requested_by,
        workflow_instance_id = excluded.workflow_instance_id,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `).bind(
      job.jobId,
      job.ticker,
      job.accessionNumber,
      job.analysisVersion,
      job.status,
      job.currentStage,
      job.attempt,
      job.errorCode ?? null,
      job.errorDetail ?? null,
      job.requestedBy,
      job.workflowInstanceId,
      job.updatedAt,
      job.completedAt ?? null,
    ).run();
  }

  async getAnalysisJobStatus(ticker: string, accessionNumber: string, analysisVersion: string): Promise<SecAnalysisJobStatus | null> {
    const row = await this.database.prepare(`
      SELECT status
      FROM sec_analysis_jobs
      WHERE ticker = ? AND accession_number = ? AND analysis_version = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(ticker, accessionNumber, analysisVersion).first<{ status: SecAnalysisJobStatus }>();
    return row?.status ?? null;
  }

  async getPublishedReport(ticker: string, periodId: string): Promise<PublishedSecReport | null> {
    try {
      const row = await this.database.prepare(`
        SELECT payload
        FROM sec_published_reports
        WHERE ticker = ? AND period_id = ?
          AND verification_status IN ('verified', 'partial')
        ORDER BY generated_at DESC
        LIMIT 1
      `).bind(ticker, periodId).first<{ payload: string }>();
      return row ? parseJson<PublishedSecReport>(row.payload) : null;
    } catch {
      return null;
    }
  }

  async getAnalysisContext(filing: SecFiling): Promise<SecAnalysisContext> {
    const { periodId, periodScope } = buildPeriodIdentity(filing.ticker, filing.form, filing.reportDate);
    const qoqPeriodId = periodScope === "quarter"
      ? (await this.database.prepare(`
        SELECT period_id AS periodId
        FROM sec_periods
        WHERE ticker = ? AND period_scope = 'quarter' AND end_date < ?
        ORDER BY end_date DESC
        LIMIT 1
      `).bind(filing.ticker, filing.reportDate).first<{ periodId: string }>())?.periodId ?? null
      : null;
    const yoyPeriodId = await this.findYearAgoPeriod(filing.ticker, filing.reportDate, periodScope);
    const qoq = qoqPeriodId ? await this.loadSnapshots(qoqPeriodId, filing.ticker) : {};
    const yoy = yoyPeriodId ? await this.loadSnapshots(yoyPeriodId, filing.ticker) : {};
    const activeMemoryRows = await this.database.prepare(`
      SELECT module_key AS moduleKey, topic_key AS topicKey, statement,
        memory_type AS memoryType, materiality_score AS materialityScore,
        confidence, first_seen_period AS firstSeenPeriod,
        last_confirmed_period AS lastConfirmedPeriod, status, evidence_ids AS evidenceIds
      FROM sec_memory_items
      WHERE ticker = ? AND status = 'active'
      ORDER BY materiality_score DESC
      LIMIT 20
    `).bind(filing.ticker).all<{
      moduleKey: string;
      topicKey: string;
      statement: string;
      memoryType: MemoryCandidate["memoryType"];
      materialityScore: number;
      confidence: "high" | "medium" | "low";
      firstSeenPeriod: string;
      lastConfirmedPeriod: string;
      status: string;
      evidenceIds: string;
    }>();
    return {
      currentPeriodId: periodId,
      qoqPeriodId,
      yoyPeriodId,
      qoq,
      yoy,
      activeMemory: activeMemoryRows.results.map((row) => ({
        topicKey: row.topicKey,
        statement: row.statement,
        memoryType: row.memoryType,
        materialityScore: row.materialityScore,
        confidence: row.confidence,
        evidenceIds: parseJson<string[]>(row.evidenceIds) ?? [],
        firstSeenPeriod: row.firstSeenPeriod,
        lastConfirmedPeriod: row.lastConfirmedPeriod,
        status: row.status,
      })),
    };
  }

  async saveAnalysis(artifact: SecAnalysisArtifact): Promise<void> {
    const filing = artifact.filing;
    await this.database.prepare(`
      INSERT INTO sec_filings (
        filing_id, ticker, accession_number, cik, form, filing_date, report_date,
        document_url, index_url, parser_version, ingest_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'analyzed')
      ON CONFLICT(filing_id) DO UPDATE SET
        form = excluded.form,
        filing_date = excluded.filing_date,
        report_date = excluded.report_date,
        document_url = excluded.document_url,
        index_url = excluded.index_url,
        parser_version = excluded.parser_version,
        ingest_status = excluded.ingest_status
    `).bind(
      filing.accessionNumber,
      filing.ticker,
      filing.accessionNumber,
      filing.cik,
      filing.form,
      filing.filingDate,
      filing.reportDate,
      filing.documentUrl,
      filing.indexUrl,
      "sec-structure.v1",
    ).run();

    const qoqPeriodId = artifact.comparisons.find((comparison) => comparison.comparisonType === "qoq")?.priorPeriodId ?? null;
    const yoyPeriodId = artifact.comparisons.find((comparison) => comparison.comparisonType === "yoy")?.priorPeriodId ?? null;
    await this.database.prepare(`
      INSERT INTO sec_periods (
        period_id, ticker, fiscal_year, fiscal_quarter, period_scope,
        end_date, qoq_period_id, yoy_period_id
      ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(period_id) DO UPDATE SET
        qoq_period_id = excluded.qoq_period_id,
        yoy_period_id = excluded.yoy_period_id
    `).bind(artifact.periodId, filing.ticker, artifact.periodScope, filing.reportDate, qoqPeriodId, yoyPeriodId).run();
    await this.database.prepare(`
      INSERT OR IGNORE INTO sec_filing_periods (filing_id, period_id, role)
      VALUES (?, ?, ?)
    `).bind(filing.accessionNumber, artifact.periodId, "primary").run();

    for (const block of artifact.blocks) {
      await this.database.prepare(`
        INSERT INTO sec_filing_blocks (
          block_id, filing_id, ordinal, heading, heading_path, element_type,
          preview, body, token_count, numeric_density, table_count, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(filing_id, ordinal) DO UPDATE SET
          block_id = excluded.block_id,
          heading = excluded.heading, heading_path = excluded.heading_path,
          element_type = excluded.element_type,
          preview = excluded.preview, body = excluded.body,
          token_count = excluded.token_count, numeric_density = excluded.numeric_density,
          table_count = excluded.table_count, content_hash = excluded.content_hash
      `).bind(
        block.blockId,
        filing.accessionNumber,
        block.ordinal,
        block.heading,
        block.headingPath,
        block.elementType,
        block.preview,
        block.body,
        block.tokenCount,
        block.numericDensity,
        block.tableCount,
        block.contentHash,
      ).run();
      await this.database.prepare(`
        INSERT INTO sec_evidence (evidence_id, filing_id, block_id, locator, excerpt, source_rank, excerpt_hash)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(evidence_id) DO UPDATE SET excerpt = excluded.excerpt, excerpt_hash = excluded.excerpt_hash
      `).bind(`ev:${block.blockId}`, filing.accessionNumber, block.blockId, `block:${block.ordinal}`, block.body.slice(0, 900), block.contentHash).run();
    }

    for (const snapshot of artifact.snapshots) {
      const snapshotId = `${snapshot.periodId}:${snapshot.moduleKey}:${hashJson(snapshot)}`;
      await this.database.prepare(`
        INSERT INTO sec_module_snapshots (
          snapshot_id, ticker, period_id, filing_id, module_key, input_hash,
          schema_version, model_version, prompt_version, payload,
          evidence_coverage, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_id) DO UPDATE SET payload = excluded.payload,
          evidence_coverage = excluded.evidence_coverage,
          verification_status = excluded.verification_status
      `).bind(
        snapshotId,
        filing.ticker,
        snapshot.periodId,
        snapshot.filingId,
        snapshot.moduleKey,
        hashJson(snapshot),
        SEC_ANALYSIS_SCHEMA_VERSION,
        "runtime-model",
        SEC_ANALYSIS_PROMPT_VERSION,
        JSON.stringify(snapshot),
        Math.round(snapshot.evidenceCoverage * 100),
        snapshot.verificationStatus,
      ).run();

      for (const fact of snapshot.facts) {
        const factId = `${snapshot.periodId}:${fact.metricKey}:${hashJson(fact)}`;
        const dimensions = { periodScope: fact.periodScope ?? "", definitionHash: fact.definitionHash ?? "" };
        const dimensionsHash = hashJson(dimensions);
        await this.database.prepare(`
          INSERT INTO sec_facts (
            fact_id, filing_id, period_id, metric_key, series_id,
            dimensions_hash, dimensions, value_decimal, raw_value, unit,
            currency, basis, evidence_label, xbrl_concept, context_ref,
            derivation_formula, evidence_id, quality_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?)
          ON CONFLICT(period_id, series_id, dimensions_hash, basis) DO UPDATE SET
            filing_id = excluded.filing_id,
            value_decimal = excluded.value_decimal,
            raw_value = excluded.raw_value,
            unit = excluded.unit,
            currency = excluded.currency,
            evidence_label = excluded.evidence_label,
            derivation_formula = excluded.derivation_formula,
            evidence_id = excluded.evidence_id,
            quality_status = excluded.quality_status
        `).bind(
          factId,
          filing.accessionNumber,
          snapshot.periodId,
          fact.metricKey,
          fact.metricKey,
          dimensionsHash,
          JSON.stringify(dimensions),
          fact.value,
          fact.value,
          fact.unit,
          fact.currency ?? "",
          fact.basis,
          fact.sourceLabel,
          fact.basis === "derived" ? "model-derived" : "model-extracted",
          fact.evidenceIds[0] ?? "",
          fact.sourceLabel === "fact_source_reported" ? "verified" : "pending_fact_check",
        ).run();
      }
    }

    for (const comparison of artifact.comparisons) {
      const comparisonId = `${comparison.currentPeriodId}:${comparison.priorPeriodId}:${comparison.comparisonType}`;
      await this.database.prepare(`
        INSERT INTO sec_comparisons (
          comparison_id, ticker, current_period_id, prior_period_id,
          comparison_type, comparability, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(comparison_id) DO UPDATE SET
          comparability = excluded.comparability, payload = excluded.payload
      `).bind(comparisonId, filing.ticker, comparison.currentPeriodId, comparison.priorPeriodId, comparison.comparisonType, comparison.comparability, JSON.stringify(comparison)).run();
    }

    for (const candidate of artifact.memoryCandidates) {
      const memoryId = `${filing.ticker}:${candidate.topicKey}`;
      await this.database.prepare(`
        INSERT INTO sec_memory_items (
          memory_id, ticker, module_key, topic_key, memory_type, statement,
          normalized_value, first_seen_period, last_confirmed_period,
          expected_resolution_period, status, materiality_score, confidence, evidence_ids
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(memory_id) DO UPDATE SET
          statement = excluded.statement,
          last_confirmed_period = excluded.last_confirmed_period,
          expected_resolution_period = excluded.expected_resolution_period,
          status = excluded.status,
          materiality_score = excluded.materiality_score,
          confidence = excluded.confidence,
          evidence_ids = excluded.evidence_ids
      `).bind(
        memoryId,
        filing.ticker,
        "cross_module",
        candidate.topicKey,
        candidate.memoryType,
        candidate.statement,
        artifact.periodId,
        artifact.periodId,
        candidate.expectedResolutionPeriod ?? null,
        candidate.materialityScore,
        candidate.confidence,
        JSON.stringify(candidate.evidenceIds),
      ).run();
      await this.database.prepare(`
        INSERT OR IGNORE INTO sec_memory_events (
          event_id, memory_id, ticker, period_id, event_type,
          current_statement, evidence_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `${memoryId}:${artifact.periodId}`,
        memoryId,
        filing.ticker,
        artifact.periodId,
        candidate.firstSeenPeriod === artifact.periodId ? "introduced" : "reaffirmed",
        candidate.statement,
        JSON.stringify(candidate.evidenceIds),
      ).run();
    }

    if (artifact.report.dataQuality.verificationStatus !== "failed") {
      await this.database.prepare(`
        INSERT INTO sec_published_reports (ticker, period_id, report_version, payload, verification_status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker, period_id, report_version) DO UPDATE SET
          payload = excluded.payload, verification_status = excluded.verification_status
      `).bind(filing.ticker, artifact.periodId, artifact.report.reportVersion, JSON.stringify(artifact.report), artifact.report.dataQuality.verificationStatus).run();
    }

    const runTime = new Date().toISOString();
    const stages = [
      { stage: "router", input: artifact.router, status: artifact.router.status },
      ...artifact.moduleAnalyses.map((analysis) => ({ stage: `module:${analysis.moduleKey}`, input: analysis, status: analysis.verificationStatus })),
      { stage: "summary", input: artifact.report, status: artifact.report.dataQuality.verificationStatus },
    ];
    for (const stage of stages) {
      const runId = `${filing.accessionNumber}:${stage.stage}:${hashJson(stage.input)}`;
      await this.database.prepare(`
        INSERT OR IGNORE INTO sec_analysis_runs (
          run_id, ticker, filing_id, stage, input_hash,
          model_version, prompt_version, status, token_usage, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
      `).bind(
        runId,
        filing.ticker,
        filing.accessionNumber,
        stage.stage,
        hashJson(stage.input),
        "runtime-model",
        SEC_ANALYSIS_PROMPT_VERSION,
        stage.status,
        runTime,
        runTime,
      ).run();
    }
  }

  private async findYearAgoPeriod(ticker: string, reportDate: string, periodScope: string): Promise<string | null> {
    if (periodScope === "annual") {
      return (await this.database.prepare(`
        SELECT period_id AS periodId FROM sec_periods
        WHERE ticker = ? AND period_scope = 'annual' AND end_date < ?
        ORDER BY end_date DESC LIMIT 1
      `).bind(ticker, reportDate).first<{ periodId: string }>())?.periodId ?? null;
    }
    return (await this.database.prepare(`
      SELECT period_id AS periodId FROM sec_periods
      WHERE ticker = ? AND period_scope = 'quarter'
        AND end_date <= date(?, '-300 day')
        AND end_date >= date(?, '-450 day')
      ORDER BY end_date DESC LIMIT 1
    `).bind(ticker, reportDate, reportDate).first<{ periodId: string }>())?.periodId ?? null;
  }

  private async loadSnapshots(periodId: string, ticker: string): Promise<Partial<Record<import("./sec-analysis.ts").SecAnalysisModuleKey, PriorSnapshotContext>>> {
    const rows = await this.database.prepare(`
      SELECT module_key AS moduleKey, payload
      FROM sec_module_snapshots
      WHERE ticker = ? AND period_id = ? AND verification_status IN ('verified', 'partial')
    `).bind(ticker, periodId).all<{ moduleKey: string; payload: string }>();
    const result: Partial<Record<import("./sec-analysis.ts").SecAnalysisModuleKey, PriorSnapshotContext>> = {};
    for (const row of rows.results) {
      const payload = parseJson<PriorSnapshotContext & { moduleKey: string }>(row.payload);
      if (!payload) continue;
      result[row.moduleKey as import("./sec-analysis.ts").SecAnalysisModuleKey] = {
        periodId,
        moduleKey: row.moduleKey as import("./sec-analysis.ts").SecAnalysisModuleKey,
        facts: payload.facts ?? [],
        claims: payload.claims ?? [],
        activeMemory: [],
      };
    }
    return result;
  }
}

export async function listHoldingPlanTickers(database: D1Like): Promise<string[]> {
  const result = await database.prepare(`
    SELECT DISTINCT ticker FROM holding_plans ORDER BY ticker
  `).bind().all<{ ticker: string }>();
  return result.results.map((row) => row.ticker);
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hashJson(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
