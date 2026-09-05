import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_ANALYSIS_SCHEMA_VERSION,
  normalizeCompanyAnalysisPublication,
  toPublicCompanyAnalysis,
} from "../lib/company-analysis/contracts.ts";
import { buildCompanyFeaturePack } from "../lib/company-analysis/feature-engine.ts";
import { resolveTargetPeriodEnd, type CompanyAnalysisPacket } from "../lib/company-analysis/packet.ts";
import { D1CompanyAnalysisRepository } from "../lib/company-analysis/repository.ts";
import type { FundamentalCurrentObservation } from "../lib/fundamentals-d1.ts";
import { applySqlMigration, SqliteD1Database } from "./helpers/sqlite-d1.ts";
import { COMPANY_AGENT_MODEL_STEP_CONFIG } from "../workers/pipeline/company-analysis-workflow.ts";
import { runCompanyAnalysisAgent } from "../workers/pipeline/company-analysis-agent.ts";
import type { SecPipelineEnv } from "../workers/pipeline/operations.ts";

const generatedAt = "2026-09-03T08:00:00.000Z";

function overview() {
  return {
    label: "业务前瞻 · AI 综述",
    headline: "核心需求仍在扩张，但资本回报进入验证期",
    introduction: "公司仍处于增长与再投资并行阶段，现有优势保持韧性，但新增投入需要转化为持续现金回报。",
    highlights: ["增长逻辑", "平台优势", "再投资", "现金约束"].map((title, index) => ({
      title,
      body: `${title}是本期最重要的变化之一。`,
      evidenceRefs: [`evidence-${index + 1}`],
    })),
  };
}

function publication(inputHash = "input-hash-123") {
  return {
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    analysisId: "company:AMZN:analysis-1",
    ticker: "AMZN",
    triggerRef: "memory-job-1:3",
    periodId: "AMZN:2026-03-31:quarterly",
    periodEnd: "2026-03-31",
    reportLabel: "截至 2026年3月31日",
    inputHash,
    memoryVersion: 3,
    fundamentalsDataVersion: "fundamentals-123",
    status: "ready",
    coverageStatus: "complete",
    overview: overview(),
    modelVersion: "glm-5.3",
    promptVersion: "company-analysis-skill.v1",
    generatedAt,
  };
}

/**
 * Evidence references used to be stripped from the public overview. They are published now: a
 * consumer that has to re-derive which observation backs a claim by reading the prose does not have
 * a usable contract. Everything internal to *how* the analysis was produced still stays inside.
 */
test("requires exactly four highlights and publishes the evidence backing each one", () => {
  const normalized = normalizeCompanyAnalysisPublication(publication());
  assert.equal(normalized.overview.highlights.length, 4);
  const publicValue = toPublicCompanyAnalysis(normalized);
  assert.equal(publicValue.overview?.highlights.length, 4);
  assert.deepEqual(
    publicValue.overview!.highlights.map((highlight) => highlight.evidenceRefs),
    normalized.overview.highlights.map((highlight) => highlight.evidenceRefs),
  );
  assert.equal("sourceLabel" in publicValue.overview!.highlights[0]!, false);
  // Internal pipeline versions are labels, reported under their own key — never a prompt.
  assert.equal(publicValue.versions.prompt, normalized.promptVersion);
  assert.equal(publicValue.versions.contentRevision, normalized.inputHash);
  assert.throws(() => normalizeCompanyAnalysisPublication({
    ...publication(),
    overview: { ...overview(), highlights: overview().highlights.slice(0, 3) },
  }), /exactly four/i);
});

test("publishes immutable analysis rows and reads the latest ready version", async () => {
  const database = new SqliteD1Database();
  try {
    await applySqlMigration(database, "../../workers/pipeline/migrations/0009_company_analysis.sql");
    await applySqlMigration(database, "../../workers/pipeline/migrations/0010_company_analysis_recovery.sql");
    const repository = new D1CompanyAnalysisRepository(database);
    const first = await repository.publish(publication());
    const duplicate = await repository.publish(publication());
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await repository.getLatestPublication("AMZN"))?.overview.headline, publication().overview.headline);
    await assert.rejects(() => repository.publish(publication("different-input-hash")), /immutable/i);
  } finally {
    database.close();
  }
});

test("promotes the same in-progress analysis row to an immutable publication", async () => {
  const database = new SqliteD1Database();
  try {
    await applySqlMigration(database, "../../workers/pipeline/migrations/0009_company_analysis.sql");
    await applySqlMigration(database, "../../workers/pipeline/migrations/0010_company_analysis_recovery.sql");
    const repository = new D1CompanyAnalysisRepository(database);
    await repository.upsertRun({
      analysisId: publication().analysisId,
      ticker: "AMZN",
      triggerRef: publication().triggerRef,
      periodId: publication().periodId,
      memoryVersion: publication().memoryVersion,
      status: "waiting_fundamentals",
      modelVersion: publication().modelVersion,
      promptVersion: publication().promptVersion,
      updatedAt: "2026-09-03T07:00:00.000Z",
    });

    const promoted = await repository.publish(publication());

    assert.equal(promoted.duplicate, false);
    assert.equal(promoted.publication.status, "ready");
    assert.equal((await repository.getLatestPublication("AMZN"))?.analysisId, publication().analysisId);
  } finally {
    database.close();
  }
});

test("backfill selects only the latest completed Memory version without an analysis run", async () => {
  const database = new SqliteD1Database();
  try {
    await applySqlMigration(database, "../../workers/pipeline/migrations/0009_company_analysis.sql");
    await applySqlMigration(database, "../../workers/pipeline/migrations/0010_company_analysis_recovery.sql");
    database.raw.exec(`
      CREATE TABLE sec_periods (period_id TEXT PRIMARY KEY, ticker TEXT NOT NULL, end_date TEXT NOT NULL);
      CREATE TABLE sec_memory_jobs (
        job_id TEXT PRIMARY KEY, ticker TEXT NOT NULL, period_id TEXT NOT NULL,
        status TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE sec_company_memory_threads (ticker TEXT PRIMARY KEY, version INTEGER NOT NULL);
      INSERT INTO sec_periods VALUES
        ('AMZN:2025-12-31:quarter', 'AMZN', '2025-12-31'),
        ('AMZN:2026-03-31:quarter', 'AMZN', '2026-03-31');
      INSERT INTO sec_memory_jobs VALUES
        ('memory-old', 'AMZN', 'AMZN:2025-12-31:quarter', 'complete', '2026-02-01T00:00:00Z'),
        ('memory-latest', 'AMZN', 'AMZN:2026-03-31:quarter', 'complete', '2026-05-01T00:00:00Z');
      INSERT INTO sec_company_memory_threads VALUES ('AMZN', 7);
    `);
    const repository = new D1CompanyAnalysisRepository(database);
    assert.deepEqual(await repository.listBackfillCandidates(["AMZN"]), [{
      ticker: "AMZN",
      memoryJobId: "memory-latest",
      memoryVersion: 7,
      periodId: "AMZN:2026-03-31:quarter",
      reportDate: "2026-03-31",
      triggerRef: "memory-latest:7",
    }]);

    await repository.upsertRun({
      analysisId: "company:AMZN:backfill",
      ticker: "AMZN",
      triggerRef: "memory-latest:7",
      periodId: "AMZN:2026-03-31:quarter",
      memoryVersion: 7,
      status: "waiting_fundamentals",
      modelVersion: "test-model",
      promptVersion: "company-analysis-skill.v1",
      updatedAt: generatedAt,
    });
    assert.deepEqual(await repository.listBackfillCandidates(["AMZN"]), []);
    assert.deepEqual(await repository.listBackfillCandidates(["AMZN"], 100, true), [], "force recovery must not duplicate active work");

    await repository.upsertRun({
      analysisId: "company:AMZN:backfill",
      ticker: "AMZN",
      triggerRef: "memory-latest:7",
      periodId: publication().periodId,
      memoryVersion: 7,
      status: "ready",
      modelVersion: publication().modelVersion,
      promptVersion: publication().promptVersion,
      updatedAt: generatedAt,
    });
    assert.deepEqual(await repository.listBackfillCandidates(["AMZN"], 100, true), []);
  } finally {
    database.close();
  }
});

test("feature engine calculates trends only from Yahoo quarterly observations", () => {
  const periods = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  const observations = periods.flatMap((periodEnd, index) => [
    observation(periodEnd, "total_revenue", String(100 + index * 10)),
    observation(periodEnd, "net_income", String(10 + index * 2)),
    observation(periodEnd, "operating_cash_flow", String(12 + index * 2)),
    observation(periodEnd, "capital_expenditure", String(-4 - index)),
    observation(periodEnd, "long_term_debt", String(40 + index)),
    observation(periodEnd, "stockholders_equity", String(80 + index * 4)),
  ]);
  const features = buildCompanyFeaturePack({
    source: "yahoo_finance",
    ticker: "AMZN",
    targetPeriodEnd: "2026-03-31",
    observations,
  });
  const revenue = features.features.find((item) => item.metricKey === "total_revenue")!;
  assert.equal(revenue.qoqGrowth, 10 / 130);
  assert.equal(revenue.yoyGrowth, 0.4);
  assert.equal(revenue.ttmValue, 500);
  assert.ok(features.derived.every((item) => item.source === "yahoo_finance"));
  assert.throws(() => buildCompanyFeaturePack({
    source: "sec",
    ticker: "AMZN",
    targetPeriodEnd: "2026-03-31",
    observations,
  }), /only accepts Yahoo Finance/i);
});

test("aligns 4-4-5 filing dates only to a nearby Yahoo revenue quarter", () => {
  const observations = [
    observation("2026-04-30", "total_revenue", "100"),
    observation("2026-01-31", "total_revenue", "90"),
  ];
  assert.equal(resolveTargetPeriodEnd(observations, "2026-05-03"), "2026-04-30");
  assert.equal(resolveTargetPeriodEnd(observations, "2026-07-26"), null);
});

test("bounds each company Agent model turn independently", () => {
  assert.deepEqual(COMPANY_AGENT_MODEL_STEP_CONFIG, {
    retries: {
      limit: 3,
      delay: "1 minute",
      backoff: "exponential",
    },
    timeout: "5 minutes",
  });
});

test("checkpoints one Agent's turns and retries invalid decisions inside the model step", async () => {
  const features = buildCompanyFeaturePack({
    source: "yahoo_finance",
    ticker: "AMZN",
    targetPeriodEnd: "2026-03-31",
    observations: [observation("2026-03-31", "total_revenue", "100")],
  });
  const evidenceRef = features.features[0]!.featureRef;
  const packet: CompanyAnalysisPacket = {
    ticker: "AMZN", periodId: "AMZN:2026-03-31:quarter", reportDate: "2026-03-31",
    targetPeriodEnd: "2026-03-31", memoryVersion: 1, fundamentalsDataVersion: "test-version",
    ready: true, reason: null, features, currentMemory: [], historicalMemory: [], priorConclusion: null,
  };
  const keys = ["business_stability", "earning_power", "balance_sheet", "cash_quality", "valuation_readiness"];
  const decision = {
    headline: "业务保持韧性", thesis: "当前证据支持继续观察业务质量。",
    internalPillars: keys.map((key) => ({
      key, state: "watch", claim: "仍需跨期验证。", evidenceRefs: [evidenceRef],
      falsifier: "后续需求持续减弱。", nextCheck: "观察下一季度经营表现。",
    })),
    selectedEvidenceRefs: [evidenceRef],
  };
  const responses = [
    { summary: "本季经营保持稳定。", drivers: [{ statement: "需求支撑经营。", evidenceRefs: [evidenceRef] }], risks: [], unresolved: [] },
    { action: "finalize", decision: { ...decision, internalPillars: [] } },
    { action: "finalize", decision },
    { ...overview(), highlights: overview().highlights.map((highlight) => ({ ...highlight, evidenceRefs: [evidenceRef] })) },
  ];
  const payloads: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    payloads.push(JSON.parse(body.messages[1].content));
    return Response.json({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] });
  };
  const stages: string[] = [];
  const result = await runCompanyAnalysisAgent({
    env: { AI_API_KEY: "test-key" } as SecPipelineEnv,
    fetcher, currentPacket: packet, crossPeriodPacket: packet,
    analysisId: "company:AMZN:test", generatedAt,
    runStage: async (stage, callback) => {
      stages.push(stage);
      try { return await callback(); } catch (error) {
        if (stage === "cross-period-round-01") return callback();
        throw error;
      }
    },
  });
  assert.deepEqual(stages, ["current-quarter", "cross-period-round-01", "editorial"]);
  assert.equal(payloads.length, 4);
  const schema = payloads[1]!.outputSchema as { decision: { internalPillars: Array<{ key: string }> } };
  assert.deepEqual(schema.decision.internalPillars.map((pillar) => pillar.key), keys);
  assert.equal(result.overview.highlights.length, 4);
});

function observation(
  periodEnd: string,
  metricKey: FundamentalCurrentObservation["metricKey"],
  valueDecimal: string,
): FundamentalCurrentObservation {
  return {
    observationId: `${periodEnd}:${metricKey}`,
    periodId: `AMZN:${periodEnd}:3M`,
    ticker: "AMZN",
    periodType: "3M",
    periodEnd,
    metricKey,
    sourceField: `quarterly${metricKey}`,
    valueDecimal,
    unitFamily: "currency",
    unit: "USD",
    currency: "USD",
    basis: "reported",
    derivationFormula: null,
    derivationVersion: null,
    sourceRunId: "run-1",
    revision: 1,
    updatedAt: generatedAt,
  };
}
