import type { SecFiling, SecFilingSummary, SecFilingWithSummary } from "./sec.ts";
import {
  buildPeriodIdentity,
  SEC_ANALYSIS_PROMPT_VERSION,
  SEC_ANALYSIS_SCHEMA_VERSION,
  type CompanyMemoryItem,
  type HistoricalObservation,
  type PriorSnapshotContext,
  type PublishedSecReport,
  type SecHistorySnapshot,
} from "./sec-analysis.ts";
import { buildCompanyMemorySummary, consolidateMemoryCandidates, type MemoryCandidateV2 } from "./sec-memory.ts";
import type { SecAnalysisArtifact, SecAnalysisContext, SecCacheRecord, SecRepository } from "./sec-service.ts";
import { decodePageCursor, encodePageCursor } from "./sec-config.ts";

type D1ResultStatement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): D1ResultStatement;
  };
  batch?(statements: D1ResultStatement[]): Promise<unknown[]>;
};

export type PublicFilingPage = {
  filings: SecFilingWithSummary[];
  nextCursor: string | null;
  total: number;
};

type PublicFilingRow = {
  filingId: string;
  ticker: string;
  accessionNumber: string;
  cik: string;
  form: string;
  filingDate: string;
  reportDate: string;
  documentUrl: string;
  indexUrl: string;
  companyName?: string | null;
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

export type SecMemoryJobClaim = {
  jobId: string;
  ticker: string;
  filingId: string;
  periodId: string;
  sourceR2Key: string;
  ownerToken: string;
  leaseUntil: string;
};

export type SecMemoryExtractionPayload = {
  candidates: MemoryCandidateV2[];
};

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

  async upsertFilingIndex(filing: SecFiling): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_filings (
        filing_id, ticker, accession_number, cik, form, filing_date, report_date,
        document_url, index_url, parser_version, ingest_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sec-structure.v1', 'indexed')
      ON CONFLICT(filing_id) DO UPDATE SET
        ticker = excluded.ticker, accession_number = excluded.accession_number,
        cik = excluded.cik, form = excluded.form, filing_date = excluded.filing_date,
        report_date = excluded.report_date, document_url = excluded.document_url,
        index_url = excluded.index_url, ingest_status = CASE
          WHEN sec_filings.ingest_status = 'analyzed' THEN sec_filings.ingest_status
          ELSE excluded.ingest_status END
    `).bind(
      filing.accessionNumber, filing.ticker, filing.accessionNumber, filing.cik,
      filing.form, filing.filingDate, filing.reportDate, filing.documentUrl, filing.indexUrl,
    ).run();
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

  async getLatestAnalysisJobStatus(ticker: string, accessionNumber: string): Promise<SecAnalysisJobStatus | null> {
    const row = await this.database.prepare(`
      SELECT status
      FROM sec_analysis_jobs
      WHERE ticker = ? AND accession_number = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(ticker, accessionNumber).first<{ status: SecAnalysisJobStatus }>();
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

  async listPublicFilings(rawTicker: string, rawCursor: string | null, rawLimit = 20): Promise<PublicFilingPage> {
    const ticker = rawTicker.trim().toUpperCase();
    const limit = Math.min(50, Math.max(1, Math.trunc(rawLimit) || 20));
    const cursor = decodePageCursor(rawCursor);
    const where = cursor
      ? "WHERE ticker = ? AND (filing_date < ? OR (filing_date = ? AND accession_number < ?))"
      : "WHERE ticker = ?";
    const values = cursor
      ? [ticker, cursor.filingDate, cursor.filingDate, cursor.accessionNumber, limit + 1]
      : [ticker, limit + 1];
    const rows = await this.database.prepare(`
      SELECT filing_id AS filingId, ticker, accession_number AS accessionNumber, cik, form,
        filing_date AS filingDate, report_date AS reportDate, document_url AS documentUrl,
        index_url AS indexUrl
      FROM sec_filings
      ${where}
      ORDER BY filing_date DESC, accession_number DESC
      LIMIT ?
    `).bind(...values).all<PublicFilingRow>();
    const totalRow = await this.database.prepare("SELECT COUNT(*) AS count FROM sec_filings WHERE ticker = ?").bind(ticker).first<{ count: number }>();
    const hasMore = rows.results.length > limit;
    const pageRows = rows.results.slice(0, limit);
    const filings = await Promise.all(pageRows.map((row) => this.hydratePublicFiling(row)));
    const last = pageRows.at(-1);
    return {
      filings,
      nextCursor: hasMore && last ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber }) : null,
      total: Number(totalRow?.count ?? 0),
    };
  }

  async getPublicFiling(rawTicker: string, rawAccession: string): Promise<SecFilingWithSummary | null> {
    const row = await this.database.prepare(`
      SELECT filing_id AS filingId, ticker, accession_number AS accessionNumber, cik, form,
        filing_date AS filingDate, report_date AS reportDate, document_url AS documentUrl,
        index_url AS indexUrl
      FROM sec_filings
      WHERE ticker = ? AND accession_number = ?
      LIMIT 1
    `).bind(rawTicker.trim().toUpperCase(), rawAccession).first<PublicFilingRow>();
    return row ? this.hydratePublicFiling(row) : null;
  }

  private async hydratePublicFiling(row: PublicFilingRow): Promise<SecFilingWithSummary> {
    const filing: SecFiling = {
      ticker: row.ticker,
      cik: row.cik,
      cikNumber: Number(row.cik.replace(/\D/g, "")) || 0,
      companyName: row.companyName ?? row.ticker,
      form: row.form,
      filingDate: row.filingDate,
      reportDate: row.reportDate,
      accessionNumber: row.accessionNumber,
      primaryDocument: row.documentUrl.split("/").at(-1) ?? "",
      description: row.form,
      items: "",
      documentUrl: row.documentUrl,
      indexUrl: row.indexUrl,
    };
    const summary = await this.getSummary(row.ticker, row.accessionNumber);
    const period = await this.database.prepare(`
      SELECT period_id AS periodId FROM sec_filing_periods WHERE filing_id = ? ORDER BY role = 'primary' DESC LIMIT 1
    `).bind(row.filingId).first<{ periodId: string }>();
    const analysis = period ? await this.getPublishedReport(row.ticker, period.periodId) : null;
    return { ...filing, summary, analysis };
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
      SELECT memory_id AS memoryId, module_key AS moduleKey, topic_key AS topicKey, statement,
        memory_type AS memoryType, materiality_score AS materialityScore,
        confidence, first_seen_period AS firstSeenPeriod,
        last_confirmed_period AS lastConfirmedPeriod, status, evidence_ids AS evidenceIds,
        kind, horizon, next_test AS nextTest, falsifier, due_period AS duePeriod,
        source_job_ids AS sourceJobIds
      FROM sec_memory_items
      WHERE ticker = ? AND (status IN ('active', 'provisional') OR (status = 'stale' AND due_period IS NOT NULL))
      ORDER BY CASE WHEN due_period IS NOT NULL THEN 0 ELSE 1 END, materiality_score DESC
      LIMIT 20
    `).bind(filing.ticker).all<{
      moduleKey: string;
      topicKey: string;
      statement: string;
      memoryId: string;
      memoryType: "guidance" | "risk" | "commitment" | "definition" | "driver" | "one_off";
      materialityScore: number;
      confidence: "high" | "medium" | "low";
      firstSeenPeriod: string;
      lastConfirmedPeriod: string;
      status: string;
      evidenceIds: string;
      kind: "fact" | "judgment";
      horizon: string | null;
      nextTest: string | null;
      falsifier: string | null;
      duePeriod: string | null;
      sourceJobIds: string;
    }>();
    const thread = await this.database.prepare(`
      SELECT summary FROM sec_company_memory_threads WHERE ticker = ?
    `).bind(filing.ticker).first<{ summary: string }>();
    const historyRows = await this.database.prepare(`
      SELECT fact_id AS observationId, series_id AS seriesId, metric_key AS metricKey,
        value_decimal AS value, unit, currency, basis, observation_start AS startDate,
        observation_end AS endDate, source_accession AS sourceAccession,
        source_filed_at AS sourceFiledAt, source_version AS sourceVersion,
        xbrl_concept AS xbrlConcept, derivation_formula AS derivationFormula,
        dimensions
      FROM sec_facts
      WHERE filing_id IN (SELECT filing_id FROM sec_filings WHERE ticker = ?)
        AND quality_status = 'validated_xbrl'
        AND source_version != 'legacy_unvalidated'
      ORDER BY observation_end DESC, source_filed_at DESC
    `).bind(filing.ticker).all<{
      observationId: string; seriesId: HistoricalObservation["seriesId"]; metricKey: string; value: string; unit: string; currency: string;
      basis: "gaap" | "derived"; startDate: string | null; endDate: string; sourceAccession: string; sourceFiledAt: string; sourceVersion: string;
      xbrlConcept: string; derivationFormula: string; dimensions: string;
    }>();
    const history = historyFromRows(historyRows.results);
    const memoryItems: CompanyMemoryItem[] = activeMemoryRows.results.map((row) => ({
      memoryId: row.memoryId,
      ticker: filing.ticker,
      kind: row.kind,
      topicKey: row.topicKey,
      statement: row.statement,
      status: row.status as CompanyMemoryItem["status"],
      materialityScore: row.materialityScore,
      confidence: row.confidence,
      evidenceIds: parseJson<string[]>(row.evidenceIds) ?? [],
      firstSeenPeriod: row.firstSeenPeriod,
      lastConfirmedPeriod: row.lastConfirmedPeriod,
      horizon: row.horizon ?? undefined,
      nextTest: row.nextTest ?? undefined,
      falsifier: row.falsifier ?? undefined,
      duePeriod: row.duePeriod ?? undefined,
      sourceJobIds: parseJson<string[]>(row.sourceJobIds) ?? [],
    }));
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
      history,
      companyMemorySummary: (thread?.summary ?? buildCompanyMemorySummary(memoryItems)).slice(0, 2_500),
      memoryItems,
    };
  }

  async saveHistory(filing: SecFiling, history: SecHistorySnapshot): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_filings (
        filing_id, ticker, accession_number, cik, form, filing_date, report_date,
        document_url, index_url, parser_version, ingest_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sec-structure.v1', 'history_loaded')
      ON CONFLICT(filing_id) DO UPDATE SET ticker = excluded.ticker, ingest_status = excluded.ingest_status
    `).bind(
      filing.accessionNumber, filing.ticker, filing.accessionNumber, filing.cik, filing.form,
      filing.filingDate, filing.reportDate, filing.documentUrl, filing.indexUrl,
    ).run();
    for (const series of history.series) {
      for (const observation of [...series.quarters, ...series.annual]) await this.saveHistoricalObservation(filing, observation);
    }
  }

  async saveAnalysis(artifact: SecAnalysisArtifact, includePublication = true): Promise<void> {
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
            derivation_formula, evidence_id, quality_status, observation_start,
            observation_end, source_filed_at, source_accession, source_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, NULL, ?, ?, ?, ?)
          ON CONFLICT(period_id, series_id, dimensions_hash, basis) DO UPDATE SET
            filing_id = excluded.filing_id,
            value_decimal = excluded.value_decimal,
            raw_value = excluded.raw_value,
            unit = excluded.unit,
            currency = excluded.currency,
            evidence_label = excluded.evidence_label,
            derivation_formula = excluded.derivation_formula,
            evidence_id = excluded.evidence_id,
            quality_status = excluded.quality_status,
            observation_end = excluded.observation_end,
            source_filed_at = excluded.source_filed_at,
            source_accession = excluded.source_accession,
            source_version = excluded.source_version
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
          filing.reportDate,
          filing.filingDate,
          filing.accessionNumber,
          SEC_ANALYSIS_SCHEMA_VERSION,
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

    if (includePublication && artifact.report.dataQuality.verificationStatus !== "failed") {
      await this.database.prepare(`
        INSERT INTO sec_published_reports (ticker, period_id, report_version, payload, verification_status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker, period_id, report_version) DO UPDATE SET
          payload = excluded.payload, verification_status = excluded.verification_status
      `).bind(filing.ticker, artifact.periodId, artifact.report.reportVersion, JSON.stringify(artifact.report), artifact.report.dataQuality.verificationStatus).run();
    }

    const runTime = new Date().toISOString();
    const stages = [
      { stage: "router", input: artifact.router, status: artifact.router.status, outputR2Key: artifact.artifactKeys?.router },
      ...artifact.moduleAnalyses.map((analysis) => ({ stage: `module:${analysis.moduleKey}`, input: analysis, status: analysis.verificationStatus, outputR2Key: artifact.artifactKeys?.[`module:${analysis.moduleKey}`] })),
      ...(artifact.brief ? [{ stage: "brief", input: artifact.brief, status: artifact.brief.evidenceQuality.invalidEvidenceIds.length ? "failed" : "complete", outputR2Key: artifact.artifactKeys?.brief }] : []),
      ...(artifact.artifactKeys?.plan ? [{ stage: "manager-plan", input: artifact.artifactKeys.plan, status: "complete", outputR2Key: artifact.artifactKeys.plan }] : []),
      ...(artifact.artifactKeys?.nodes ? [{ stage: "nodes", input: artifact.artifactKeys.nodes, status: artifact.managerReview?.status ?? "complete", outputR2Key: artifact.artifactKeys.nodes }] : []),
      ...(artifact.managerReview ? [{ stage: "manager-review", input: artifact.managerReview, status: artifact.managerReview.status, outputR2Key: artifact.artifactKeys?.["manager-review"] }] : []),
      ...(artifact.claimLedger ? [{ stage: "claim-ledger", input: artifact.claimLedger, status: "complete", outputR2Key: artifact.artifactKeys?.claimLedger }] : []),
      { stage: "summary", input: artifact.report, status: artifact.report.dataQuality.verificationStatus, outputR2Key: artifact.artifactKeys?.synthesis },
    ];
    for (const stage of stages) {
      const runId = `${filing.accessionNumber}:${stage.stage}:${hashJson(stage.input)}`;
      const round = Number(stage.stage.match(/round[-:]?(\d+)/)?.[1] ?? 0);
      await this.database.prepare(`
        INSERT OR IGNORE INTO sec_analysis_runs (
          run_id, ticker, filing_id, stage, input_hash,
          model_version, prompt_version, status, token_usage, started_at, completed_at,
          output_r2_key, round, stop_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)
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
        stage.outputR2Key ?? null,
        round,
        artifact.managerReview?.stopReason ?? null,
      ).run();
    }
  }

  async commitFinalPublication(artifact: SecAnalysisArtifact, summary: SecFilingSummary): Promise<string> {
    if (artifact.report.dataQuality.verificationStatus === "failed") throw new Error("Failed SEC analysis cannot be published");
    if (!this.database.batch) throw new Error("D1 batch is required for atomic SEC publication");
    const memoryJobId = `${artifact.filing.ticker}:${artifact.periodId}:${artifact.report.reportVersion}:memory`;
    const sourceR2Key = artifact.artifactKeys?.synthesis ?? artifact.artifactKeys?.claimLedger;
    if (!sourceR2Key) throw new Error("SEC publication is missing its R2 memory source");
    const statements = [
      this.database.prepare(`
        INSERT INTO sec_published_reports (ticker, period_id, report_version, payload, verification_status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker, period_id, report_version) DO UPDATE SET
          payload = excluded.payload, verification_status = excluded.verification_status
      `).bind(artifact.filing.ticker, artifact.periodId, artifact.report.reportVersion, JSON.stringify(artifact.report), artifact.report.dataQuality.verificationStatus),
      this.database.prepare(`
        INSERT INTO sec_filing_summaries (ticker, accession_number, generated_at, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ticker, accession_number) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload
      `).bind(summary.ticker, summary.accessionNumber, summary.generatedAt, JSON.stringify(summary)),
      this.database.prepare(`
        INSERT INTO sec_memory_jobs (job_id, ticker, filing_id, period_id, status, source_r2_key, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO NOTHING
      `).bind(memoryJobId, artifact.filing.ticker, artifact.filing.accessionNumber, artifact.periodId, sourceR2Key),
    ];
    await this.database.batch(statements);
    return memoryJobId;
  }

  async claimMemoryJob(jobId: string | null, ownerToken: string, now: Date, leaseMilliseconds = 5 * 60_000, allowedTickers?: string[]): Promise<SecMemoryJobClaim | null> {
    if (!this.database.batch) throw new Error("D1 batch is required for memory lease claims");
    if (allowedTickers && !allowedTickers.length) return null;
    const tickerClause = allowedTickers ? ` AND ticker IN (${allowedTickers.map(() => "?").join(",")})` : "";
    const tickerValues = allowedTickers ?? [];
    const candidate = jobId
      ? await this.database.prepare(`
        SELECT job_id AS jobId, ticker, filing_id AS filingId, period_id AS periodId, source_r2_key AS sourceR2Key, status
        FROM sec_memory_jobs WHERE job_id = ?${tickerClause}
      `).bind(jobId, ...tickerValues).first<{ jobId: string; ticker: string; filingId: string; periodId: string; sourceR2Key: string; status: string }>()
      : await this.database.prepare(`
        SELECT job_id AS jobId, ticker, filing_id AS filingId, period_id AS periodId, source_r2_key AS sourceR2Key, status
        FROM sec_memory_jobs
        WHERE (status = 'pending' OR (status = 'running' AND lease_until < ?))${tickerClause}
        ORDER BY created_at ASC LIMIT 1
      `).bind(now.toISOString(), ...tickerValues).first<{ jobId: string; ticker: string; filingId: string; periodId: string; sourceR2Key: string; status: string }>();
    if (!candidate || candidate.status === "complete") return null;
    const leaseUntil = new Date(now.getTime() + leaseMilliseconds).toISOString();
    await this.database.batch([
      this.database.prepare(`
        INSERT INTO sec_company_memory_threads (ticker, summary, version, lease_owner, lease_until, updated_at)
        VALUES (?, '', 0, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET lease_owner = excluded.lease_owner, lease_until = excluded.lease_until, updated_at = excluded.updated_at
        WHERE sec_company_memory_threads.lease_until IS NULL OR sec_company_memory_threads.lease_until < ? OR sec_company_memory_threads.lease_owner = ?
      `).bind(candidate.ticker, ownerToken, leaseUntil, now.toISOString(), now.toISOString(), ownerToken),
      this.database.prepare(`
        UPDATE sec_memory_jobs
        SET status = 'running', owner_token = ?, lease_until = ?, attempt = attempt + 1, updated_at = ?
        WHERE job_id = ?
          AND (status = 'pending' OR lease_until < ? OR owner_token = ?)
          AND EXISTS (
            SELECT 1 FROM sec_company_memory_threads
            WHERE ticker = ? AND lease_owner = ? AND lease_until = ?
          )
      `).bind(ownerToken, leaseUntil, now.toISOString(), candidate.jobId, now.toISOString(), ownerToken, candidate.ticker, ownerToken, leaseUntil),
    ]);
    const claimed = await this.database.prepare(`
      SELECT j.job_id AS jobId, j.ticker, j.filing_id AS filingId, j.period_id AS periodId,
        j.source_r2_key AS sourceR2Key, j.owner_token AS ownerToken, j.lease_until AS leaseUntil
      FROM sec_memory_jobs j
      JOIN sec_company_memory_threads t ON t.ticker = j.ticker
      WHERE j.job_id = ? AND j.owner_token = ? AND t.lease_owner = ?
    `).bind(candidate.jobId, ownerToken, ownerToken).first<SecMemoryJobClaim>();
    return claimed ?? null;
  }

  async commitMemoryJob(claim: SecMemoryJobClaim, extraction: SecMemoryExtractionPayload): Promise<{ noOp: boolean; itemCount: number }> {
    if (!this.database.batch) throw new Error("D1 batch is required for memory commit");
    const ownership = await this.database.prepare(`
      SELECT j.status, j.owner_token AS ownerToken, t.lease_owner AS threadOwner
      FROM sec_memory_jobs j JOIN sec_company_memory_threads t ON t.ticker = j.ticker
      WHERE j.job_id = ?
    `).bind(claim.jobId).first<{ status: string; ownerToken: string | null; threadOwner: string | null }>();
    if (ownership?.status === "complete") return { noOp: true, itemCount: 0 };
    if (!ownership || ownership.ownerToken !== claim.ownerToken || ownership.threadOwner !== claim.ownerToken) throw new Error("Memory lease ownership changed");
    const rows = await this.database.prepare(`
      SELECT memory_id AS memoryId, ticker, kind, topic_key AS topicKey, statement, status,
        materiality_score AS materialityScore, confidence, evidence_ids AS evidenceIds,
        first_seen_period AS firstSeenPeriod, last_confirmed_period AS lastConfirmedPeriod,
        horizon, next_test AS nextTest, falsifier, due_period AS duePeriod, source_job_ids AS sourceJobIds
      FROM sec_memory_items WHERE ticker = ?
    `).bind(claim.ticker).all<{
      memoryId: string; ticker: string; kind: "fact" | "judgment"; topicKey: string; statement: string; status: CompanyMemoryItem["status"];
      materialityScore: number; confidence: CompanyMemoryItem["confidence"]; evidenceIds: string; firstSeenPeriod: string; lastConfirmedPeriod: string;
      horizon: string | null; nextTest: string | null; falsifier: string | null; duePeriod: string | null; sourceJobIds: string;
    }>();
    const currentItems: CompanyMemoryItem[] = rows.results.map((row) => ({
      ...row,
      evidenceIds: parseJson<string[]>(row.evidenceIds) ?? [],
      sourceJobIds: parseJson<string[]>(row.sourceJobIds) ?? [],
      horizon: row.horizon ?? undefined,
      nextTest: row.nextTest ?? undefined,
      falsifier: row.falsifier ?? undefined,
      duePeriod: row.duePeriod ?? undefined,
    }));
    const consolidated = consolidateMemoryCandidates({ ticker: claim.ticker, periodId: claim.periodId, items: currentItems }, extraction.candidates, claim.jobId);
    const now = new Date().toISOString();
    const ownershipGuard = `
      SELECT 1
      FROM sec_memory_jobs j
      JOIN sec_company_memory_threads t ON t.ticker = j.ticker
      WHERE j.job_id = ? AND j.status = 'running' AND j.owner_token = ? AND t.lease_owner = ?
    `;
    const statements: D1ResultStatement[] = [
      this.database.prepare(`
        INSERT INTO sec_memory_extractions (extraction_id, job_id, ticker, period_id, payload, input_hash, schema_version)
        SELECT ?, ?, ?, ?, ?, ?, 'sec-memory-extraction.v1'
        WHERE EXISTS (${ownershipGuard})
        ON CONFLICT(job_id) DO NOTHING
      `).bind(
        `extraction:${hashJson(claim.jobId)}`, claim.jobId, claim.ticker, claim.periodId, JSON.stringify(extraction), hashJson(extraction),
        claim.jobId, claim.ownerToken, claim.ownerToken,
      ),
    ];
    for (const item of consolidated.items) statements.push(this.database.prepare(`
      INSERT INTO sec_memory_items (
        memory_id, ticker, module_key, topic_key, memory_type, statement, normalized_value,
        first_seen_period, last_confirmed_period, expected_resolution_period, status,
        materiality_score, confidence, evidence_ids, kind, horizon, next_test, falsifier,
        due_period, source_job_ids, normalized_key, version, updated_at
      ) SELECT ?, ?, 'cross_module', ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
      WHERE EXISTS (${ownershipGuard})
      ON CONFLICT(memory_id) DO UPDATE SET
        statement = excluded.statement, last_confirmed_period = excluded.last_confirmed_period,
        status = excluded.status, materiality_score = excluded.materiality_score,
        confidence = excluded.confidence, evidence_ids = excluded.evidence_ids,
        kind = excluded.kind, horizon = excluded.horizon, next_test = excluded.next_test,
        falsifier = excluded.falsifier, due_period = excluded.due_period,
        source_job_ids = excluded.source_job_ids, normalized_key = excluded.normalized_key,
        version = sec_memory_items.version + 1, updated_at = excluded.updated_at
      WHERE EXISTS (${ownershipGuard})
    `).bind(
      item.memoryId, item.ticker, item.topicKey, item.kind, item.statement,
      item.firstSeenPeriod, item.lastConfirmedPeriod, item.horizon ?? null, item.status,
      item.materialityScore, item.confidence, JSON.stringify(item.evidenceIds), item.kind,
      item.horizon ?? null, item.nextTest ?? null, item.falsifier ?? null, item.duePeriod ?? null,
      JSON.stringify(item.sourceJobIds ?? []), `${item.kind}:${item.topicKey.toLowerCase()}`, now,
      claim.jobId, claim.ownerToken, claim.ownerToken,
      claim.jobId, claim.ownerToken, claim.ownerToken,
    ));
    for (const event of consolidated.events) statements.push(this.database.prepare(`
      INSERT OR IGNORE INTO sec_memory_events (
        event_id, memory_id, ticker, period_id, event_type, current_statement, prior_statement, evidence_ids, job_id
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (${ownershipGuard})
    `).bind(
      event.eventId, event.memoryId, claim.ticker, claim.periodId, event.eventType, event.currentStatement, event.priorStatement ?? null, JSON.stringify(event.evidenceIds), claim.jobId,
      claim.jobId, claim.ownerToken, claim.ownerToken,
    ));
    const summary = buildCompanyMemorySummary(consolidated.items);
    statements.push(this.database.prepare(`
      UPDATE sec_company_memory_threads
      SET summary = ?, version = version + 1, lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE ticker = ? AND lease_owner = ?
    `).bind(summary, now, claim.ticker, claim.ownerToken));
    statements.push(this.database.prepare(`
      UPDATE sec_memory_jobs
      SET status = 'complete', completed_at = ?, updated_at = ?, lease_until = NULL, error = NULL
      WHERE job_id = ? AND owner_token = ?
        AND EXISTS (SELECT 1 FROM sec_company_memory_threads WHERE ticker = ? AND lease_owner IS NULL)
    `).bind(now, now, claim.jobId, claim.ownerToken, claim.ticker));
    await this.database.batch(statements);
    const completion = await this.database.prepare(`
      SELECT status, owner_token AS ownerToken FROM sec_memory_jobs WHERE job_id = ?
    `).bind(claim.jobId).first<{ status: string; ownerToken: string | null }>();
    if (completion?.status !== "complete") throw new Error("Memory lease ownership changed before commit");
    return { noOp: consolidated.noOp, itemCount: consolidated.items.length };
  }

  private async saveHistoricalObservation(filing: SecFiling, observation: HistoricalObservation): Promise<void> {
    const periodId = `${filing.ticker}:${observation.endDate}:${observation.periodScope}`;
    const dimensions = {
      ticker: filing.ticker,
      periodScope: observation.periodScope,
      startDate: observation.startDate ?? "",
      endDate: observation.endDate,
      unit: observation.unit,
      currency: observation.currency ?? "",
    };
    const dimensionsHash = hashJson(dimensions);
    await this.database.prepare(`
      INSERT INTO sec_periods (period_id, ticker, fiscal_year, fiscal_quarter, period_scope, start_date, end_date, duration_days)
      VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL)
      ON CONFLICT(period_id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date
    `).bind(periodId, filing.ticker, observation.periodScope, observation.startDate ?? null, observation.endDate).run();
    await this.database.prepare(`
      INSERT INTO sec_facts (
        fact_id, filing_id, period_id, metric_key, series_id, dimensions_hash, dimensions,
        value_decimal, raw_value, unit, currency, basis, evidence_label, xbrl_concept,
        context_ref, derivation_formula, evidence_id, quality_status, observation_start,
        observation_end, source_filed_at, source_accession, source_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fact_source_reported', ?, '', ?, ?, 'validated_xbrl', ?, ?, ?, ?, ?)
      ON CONFLICT(period_id, series_id, dimensions_hash, basis) DO UPDATE SET
        filing_id = excluded.filing_id,
        value_decimal = excluded.value_decimal,
        raw_value = excluded.raw_value,
        unit = excluded.unit,
        currency = excluded.currency,
        xbrl_concept = excluded.xbrl_concept,
        derivation_formula = excluded.derivation_formula,
        evidence_id = excluded.evidence_id,
        quality_status = excluded.quality_status,
        observation_start = excluded.observation_start,
        observation_end = excluded.observation_end,
        source_filed_at = excluded.source_filed_at,
        source_accession = excluded.source_accession,
        source_version = excluded.source_version
      WHERE excluded.source_filed_at >= sec_facts.source_filed_at
    `).bind(
      observation.observationId,
      filing.accessionNumber,
      periodId,
      observation.metricKey,
      observation.seriesId,
      dimensionsHash,
      JSON.stringify(dimensions),
      observation.value,
      observation.value,
      observation.unit,
      observation.currency ?? "",
      observation.basis,
      observation.xbrlConcept ?? "",
      observation.derivationFormula ?? "",
      `xbrl:${observation.sourceAccession}:${observation.xbrlConcept ?? observation.seriesId}`,
      observation.startDate ?? null,
      observation.endDate,
      observation.sourceFiledAt,
      observation.sourceAccession,
      observation.sourceVersion,
    ).run();
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

function historyFromRows(rows: Array<{
  observationId: string; seriesId: HistoricalObservation["seriesId"]; metricKey: string; value: string; unit: string; currency: string;
  basis: "gaap" | "derived"; startDate: string | null; endDate: string; sourceAccession: string; sourceFiledAt: string; sourceVersion: string;
  xbrlConcept: string; derivationFormula: string; dimensions: string;
}>): SecHistorySnapshot {
  const observations: HistoricalObservation[] = rows.flatMap((row) => {
    const dimensions = parseJson<{ periodScope?: "quarter" | "annual" }>(row.dimensions);
    const periodScope = dimensions?.periodScope;
    if (periodScope !== "quarter" && periodScope !== "annual") return [];
    return [{
      observationId: row.observationId,
      seriesId: row.seriesId,
      metricKey: row.metricKey,
      value: row.value,
      unit: row.unit,
      currency: row.currency || undefined,
      basis: row.basis,
      periodScope,
      startDate: row.startDate ?? undefined,
      endDate: row.endDate,
      sourceAccession: row.sourceAccession,
      sourceFiledAt: row.sourceFiledAt,
      sourceVersion: row.sourceVersion,
      qualityStatus: "validated_xbrl",
      xbrlConcept: row.xbrlConcept || undefined,
      derivationFormula: row.derivationFormula || undefined,
    }];
  });
  return {
    registryVersion: observations[0]?.sourceVersion ?? "sec-canonical-series.v1",
    series: [...new Set(observations.map((item) => item.seriesId))].map((seriesId) => ({
      seriesId,
      quarters: observations.filter((item) => item.seriesId === seriesId && item.periodScope === "quarter").slice(0, 8),
      annual: observations.filter((item) => item.seriesId === seriesId && item.periodScope === "annual").slice(0, 5),
    })),
  };
}
