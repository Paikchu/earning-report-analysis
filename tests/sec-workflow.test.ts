import assert from "node:assert/strict";
import test from "node:test";

import { executeSecAnalysisWorkflow, type SecPipelineOperations, type WorkflowStepLike } from "../workers/sec-cron/workflow-core.ts";
import { SEC_ANALYSIS_MODULES, SEC_ANALYSIS_SCHEMA_VERSION, type ModuleAnalysis } from "../lib/sec-analysis.ts";
import type { SecFiling, SecFilingSummary, SecNodeSpec } from "../lib/sec.ts";

const filing: SecFiling = {
  ticker: "MSFT",
  cik: "0000789019",
  cikNumber: 789019,
  companyName: "Microsoft Corp",
  form: "10-K",
  filingDate: "2026-07-30",
  reportDate: "2026-06-30",
  accessionNumber: "0000789019-26-000001",
  primaryDocument: "msft.htm",
  description: "Annual report",
  items: "",
  documentUrl: "https://sec.test/msft.htm",
  indexUrl: "https://sec.test/index.htm",
};

test("uses the v2 analysis schema for full-report recomputation", () => {
  assert.equal(SEC_ANALYSIS_SCHEMA_VERSION, "sec-analysis.v2");
});

function stepRecorder(names: string[]): WorkflowStepLike {
  return {
    async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      return callback();
    },
  };
}

function operations(overrides: Partial<SecPipelineOperations> = {}): SecPipelineOperations {
  const moduleAnalysis = (moduleKey: ModuleAnalysis["moduleKey"]): ModuleAnalysis => ({
    moduleKey,
    facts: [],
    claims: [],
    memoryCandidates: [],
    missingFields: [],
    evidenceCoverage: 1,
    verificationStatus: "verified",
  });
  return {
    async discover() { return { feed: { ticker: "MSFT" }, filings: [filing] }; },
    async publishFeed() {},
    async shouldAnalyze() { return true; },
    async getContext() { return { currentPeriodId: "MSFT:2026-06-30:annual", qoqPeriodId: null, yoyPeriodId: null, qoq: {}, yoy: {}, activeMemory: [] }; },
    async prepare() { return { key: "MSFT/acc.json", filing }; },
    async route() { return { selections: [], source: "fallback", status: "partial", missingModules: [] }; },
    async analyzeModule(moduleKey) { return moduleAnalysis(moduleKey); },
    async plan() {
      return {
        nodes: [
          { id: "revenue-growth", title: "收入增长", question: "收入增长由什么驱动？", sectionIds: ["revenue"], keywords: ["revenue"] },
          { id: "cash-flow", title: "现金流", question: "现金流发生了什么变化？", sectionIds: ["cash-flow"], keywords: ["cash flow"] },
        ],
        outlineSections: 8,
      };
    },
    async analyzeNode(spec) {
      return {
        id: spec.id,
        title: spec.title,
        status: "complete",
        findings: [{ label: spec.title, detail: `${spec.title}出现可量化变化。`, importance: "high" }],
        narrative: `${spec.title}的分段分析。`,
        evidence: [{ start: 10, end: 40, score: 90, reasons: ["包含定量数据"], excerpt: "Quantitative evidence." }],
      };
    },
    async summarizeEvent(eventFiling) {
      return {
        ticker: eventFiling.ticker,
        form: eventFiling.form,
        filingDate: eventFiling.filingDate,
        accessionNumber: eventFiling.accessionNumber,
        headline: "事件简析",
        bullets: [{ label: "事件", detail: "事件影响已披露。", importance: "high" }],
        analystView: "事件改变了短期预期。",
        source: "deepseek",
        generatedAt: "2026-08-10T00:00:00.000Z",
      };
    },
    async summarize() {
      return {
        artifact: {
          filing,
          periodId: "MSFT:2026-06-30:annual",
          periodScope: "annual",
          blocks: [],
          moduleAnalyses: SEC_ANALYSIS_MODULES.map((module) => moduleAnalysis(module.key)),
          snapshots: [],
          comparisons: [],
          memoryCandidates: [],
          router: { selections: [], source: "fallback", status: "partial", missingModules: [] },
          report: {
            ticker: "MSFT",
            periodId: "MSFT:2026-06-30:annual",
            reportVersion: "sec-analysis.v2:test",
            headline: "verified",
            keyMetrics: [],
            changes: { qoq: [], yoy: [], guidance: [], risks: [] },
            dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
          },
        },
        summary: {
          ticker: "MSFT",
          form: "10-K",
          filingDate: "2026-07-30",
          accessionNumber: filing.accessionNumber,
          headline: "完整研报",
          bullets: [{ label: "收入", detail: "收入增长。", importance: "high" }],
          analystView: "关注增长质量。",
          report: "完整分析正文。",
          version: 5,
          source: "deepseek",
          generatedAt: "2026-08-10T00:00:00.000Z",
        },
      };
    },
    async publish() {},
    async publishEvent() {},
    async updateJob() {},
    ...overrides,
  };
}

test("runs filing analysis as durable stages and fans modules out independently", async () => {
  const steps: string[] = [];
  const moduleKeys: string[] = [];
  const nodeIds: string[] = [];
  const jobStages: string[] = [];
  const jobIds: string[] = [];
  let published = 0;
  let publishedSummary: SecFilingSummary | null = null;
  const ops = operations({
    async analyzeModule(moduleKey) {
      moduleKeys.push(moduleKey);
      return operations().analyzeModule(moduleKey, {} as never, {} as never, {} as never, {} as never);
    },
    async analyzeNode(spec: SecNodeSpec) {
      nodeIds.push(spec.id);
      return operations().analyzeNode(spec, {} as never, {} as never);
    },
    async publish(_artifact, summary) {
      published += 1;
      publishedSummary = summary;
    },
    async updateJob(job) {
      jobStages.push(job.currentStage);
      jobIds.push(job.jobId);
    },
  });

  const result = await executeSecAnalysisWorkflow(
    { ticker: "MSFT", requestedBy: "scheduled" },
    "workflow-1",
    stepRecorder(steps),
    ops,
  );

  assert.deepEqual(result, { analyzed: [filing.accessionNumber], skipped: [], failed: [] });
  assert.deepEqual(moduleKeys, SEC_ANALYSIS_MODULES.map((module) => module.key));
  assert.deepEqual(nodeIds, ["revenue-growth", "cash-flow"]);
  assert.equal(published, 1);
  assert.ok(steps.includes(`prepare:${filing.accessionNumber}`));
  assert.ok(steps.includes(`router:${filing.accessionNumber}`));
  assert.ok(steps.includes(`manager:${filing.accessionNumber}`));
  assert.ok(steps.includes(`node:${filing.accessionNumber}:0:revenue-growth`));
  assert.ok(steps.includes(`node:${filing.accessionNumber}:1:cash-flow`));
  assert.ok(steps.includes(`publish:${filing.accessionNumber}`));
  assert.deepEqual(jobStages, ["context", "prepare", "router", "modules", "manager", "nodes", "synthesis", "publish", "published"]);
  assert.ok(jobIds.every((jobId) => jobId.endsWith(":workflow-1")));
  assert.deepEqual(publishedSummary?.workflow?.nodes.map((node) => node.id), [
    "filing-selection",
    "document",
    "outline",
    "manager-plan",
    "structured-verification",
    "analysis-nodes",
    "synthesis",
    "persistence",
  ]);
});

test("keeps event filings on the compact path without running full-report stages", async () => {
  const eventFiling = { ...filing, form: "8-K", accessionNumber: "event", items: "2.02" };
  const steps: string[] = [];
  let compactPublished = 0;
  let modules = 0;
  const ops = operations({
    async discover() { return { feed: { ticker: "MSFT" }, filings: [eventFiling] }; },
    async prepare() { return { key: "MSFT/event.json", filing: eventFiling }; },
    async analyzeModule(moduleKey) {
      modules += 1;
      return operations().analyzeModule(moduleKey, {} as never, {} as never, {} as never, {} as never);
    },
    async publishEvent(summary) {
      compactPublished += 1;
      assert.equal(summary.form, "8-K");
    },
  });

  const result = await executeSecAnalysisWorkflow(
    { ticker: "MSFT", requestedBy: "scheduled" },
    "workflow-event",
    stepRecorder(steps),
    ops,
  );

  assert.deepEqual(result.analyzed, ["event"]);
  assert.equal(compactPublished, 1);
  assert.equal(modules, 0);
  assert.ok(steps.includes("event-summary:event"));
  assert.ok(steps.includes("publish-event:event"));
  assert.equal(steps.some((step) => step.startsWith("manager:event")), false);
});

test("keeps a failed verification artifact out of the published report table", async () => {
  let published = 0;
  const jobStatuses: string[] = [];
  const base = operations();
  const ops = operations({
    async summarize(...args) {
      const result = await base.summarize(...args);
      result.artifact.report.dataQuality.verificationStatus = "failed";
      return result;
    },
    async publish() { published += 1; },
    async updateJob(job) { jobStatuses.push(job.status); },
  });

  const result = await executeSecAnalysisWorkflow(
    { ticker: "MSFT", requestedBy: "manual" },
    "workflow-2",
    stepRecorder([]),
    ops,
  );

  assert.equal(published, 0);
  assert.deepEqual(result.failed, [filing.accessionNumber]);
  assert.equal(jobStatuses.at(-1), "failed");
});

test("skips a completed filing during scheduled refreshes", async () => {
  const steps: string[] = [];
  let prepared = 0;
  const ops = operations({
    async shouldAnalyze() { return false; },
    async prepare() {
      prepared += 1;
      return { key: "unused", filing };
    },
  });

  const result = await executeSecAnalysisWorkflow(
    { ticker: "MSFT", requestedBy: "scheduled" },
    "workflow-3",
    stepRecorder(steps),
    ops,
  );

  assert.deepEqual(result, { analyzed: [], skipped: [filing.accessionNumber], failed: [] });
  assert.equal(prepared, 0);
  assert.ok(steps.includes(`status:${filing.accessionNumber}`));
});
