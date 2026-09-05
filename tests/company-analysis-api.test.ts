import assert from "node:assert/strict";
import test from "node:test";

import { getPublicCompanyAnalysis } from "../lib/company-analysis/api.ts";
import {
  COMPANY_ANALYSIS_SCHEMA_VERSION,
  normalizeCompanyAnalysisPublication,
} from "../lib/company-analysis/contracts.ts";

function readyPublication() {
  return normalizeCompanyAnalysisPublication({
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    analysisId: "company:AMZN:analysis-1",
    ticker: "AMZN",
    triggerRef: "memory-job-1:3",
    periodId: "AMZN:2026-03-31:quarterly",
    periodEnd: "2026-03-31",
    reportLabel: "截至 2026年3月31日",
    inputHash: "input-hash-123",
    memoryVersion: 3,
    fundamentalsDataVersion: "fundamentals-123",
    status: "ready",
    coverageStatus: "complete",
    overview: {
      label: "业务前瞻 · AI 综述",
      headline: "增长保持韧性，资本效率成为下一阶段验证重点",
      introduction: "公司保持增长，但资本效率需要验证。",
      highlights: ["增长", "平台", "投入", "风险"].map((title, index) => ({
        title,
        body: `${title}判断。`,
        evidenceRefs: [`evidence-${index + 1}`],
      })),
    },
    modelVersion: "glm-5.3",
    promptVersion: "company-analysis-skill.v1",
    generatedAt: "2026-09-03T08:00:00.000Z",
  });
}

/**
 * Evidence references used to be stripped here. They are published now: a consumer that has to
 * re-derive which observation backs a claim by reading the prose does not have a usable contract.
 * What stays unpublished is anything internal to how the analysis was produced.
 */
test("public overview publishes last-good content with the evidence backing it", async () => {
  const publication = await readyPublication();
  const payload = await getPublicCompanyAnalysis({
    async getLatestPublication() { return publication; },
    async hasNewerActiveRun() { return true; },
    async getLatestRunSummary() { return { state: "running" as const, updatedAt: "2026-09-04T00:00:00.000Z", errorCode: null }; },
  }, "amzn");
  assert.equal(payload.status, "updating");
  assert.equal(payload.overview?.highlights.length, 4);
  assert.deepEqual(payload.overview!.highlights[0]!.evidenceRefs, ["evidence-1"]);
  assert.equal("sourceLabel" in payload.overview!.highlights[0]!, false);
  assert.equal("fullReportRef" in payload, false);
  // A newer run in flight is reported beside the published result, not instead of it.
  assert.equal(payload.latestRun.state, "running");
  assert.equal(payload.overview?.headline, publication.overview.headline);
});
