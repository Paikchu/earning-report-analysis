import assert from "node:assert/strict";
import test from "node:test";

import { executeSecAnalysisWorkflow, type SecPipelineOperations, type WorkflowStepLike } from "../workers/sec-cron/workflow-core.ts";
import { SEC_ANALYSIS_MODULES, type ModuleAnalysis } from "../lib/sec-analysis.ts";
import type { SecFiling } from "../lib/sec.ts";

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
        summary: null,
      };
    },
    async publish() {},
    async updateJob() {},
    ...overrides,
  };
}

test("runs filing analysis as durable stages and fans modules out independently", async () => {
  const steps: string[] = [];
  const moduleKeys: string[] = [];
  const jobStages: string[] = [];
  const jobIds: string[] = [];
  let published = 0;
  const ops = operations({
    async analyzeModule(moduleKey) {
      moduleKeys.push(moduleKey);
      return operations().analyzeModule(moduleKey, {} as never, {} as never, {} as never, {} as never);
    },
    async publish() { published += 1; },
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
  assert.equal(published, 1);
  assert.ok(steps.includes(`prepare:${filing.accessionNumber}`));
  assert.ok(steps.includes(`router:${filing.accessionNumber}`));
  assert.ok(steps.includes(`publish:${filing.accessionNumber}`));
  assert.deepEqual(jobStages, ["context", "prepare", "router", "modules", "summary", "publish", "published"]);
  assert.ok(jobIds.every((jobId) => jobId.endsWith(":workflow-1")));
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
