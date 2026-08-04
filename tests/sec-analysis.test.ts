import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFilingBlocks,
  compareSnapshots,
  normalizeModuleAnalysis,
  normalizeRouterResult,
  type PriorSnapshotContext,
  type SnapshotSummary,
} from "../lib/sec-analysis.ts";
import { refreshSecTicker, type SecCacheRecord, type SecRepository, type SecAnalysisArtifact } from "../lib/sec-service.ts";
import type { SecFiling, SecFilingSummary } from "../lib/sec.ts";

const blocks = buildFilingBlocks([
  "Item 1. Business",
  "The company operates a cloud platform.",
  "Item 7. Management Discussion",
  "Revenue increased 20% and operating margin expanded.",
  "Item 8. Financial Statements",
  "Revenue 76,400; operating income 30,100.",
].join("\n"), "acc-1");

test("builds stable filing blocks with numeric density and evidence-sized previews", () => {
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].heading, "Item 8. Financial Statements");
  assert.ok(blocks[2].numericDensity > 0);
  assert.equal(blocks[2].blockId.startsWith("acc-1:block:"), true);
});

test("router discards hallucinated block IDs before persistence", () => {
  const result = normalizeRouterResult({
    selections: [
      { moduleKey: "performance", blockIds: [blocks[2].blockId, "made-up-block"], expectedFields: ["revenue"], confidence: 0.9 },
    ],
  }, blocks);
  assert.deepEqual(result.selections[0].blockIds, [blocks[2].blockId]);
  assert.equal(result.source, "model");
  assert.equal(result.status, "partial");
});

test("module output cannot cite evidence outside the selected filing", () => {
  const evidenceId = `ev:${blocks[2].blockId}`;
  const result = normalizeModuleAnalysis({
    facts: [
      { metricKey: "revenue", value: "76400", unit: "USDm", basis: "gaap", evidenceIds: [evidenceId, "ev:other-filing"], confidence: "high" },
    ],
    claims: [{ topicKey: "cloud", statement: "Cloud growth drove revenue.", evidenceIds: ["ev:other-filing"] }],
    evidenceCoverage: 1,
  }, "performance", new Set([evidenceId]));
  assert.equal(result.facts.length, 1);
  assert.deepEqual(result.facts[0].evidenceIds, [evidenceId]);
  assert.equal(result.claims.length, 0);
});

test("comparison keeps qoq and yoy separate and marks narrative omission explicitly", () => {
  const current: SnapshotSummary = {
    ticker: "MSFT",
    periodId: "MSFT:2026-06-30:quarter",
    filingId: "current",
    moduleKey: "performance",
    facts: [{ metricKey: "revenue", value: "120", unit: "USDm", basis: "gaap", evidenceIds: ["ev:current"], confidence: "high", sourceLabel: "fact_source_reported", definitionHash: "v1" }],
    claims: [{ topicKey: "cloud", claimType: "driver", statement: "Cloud remained the growth driver.", direction: "positive", horizon: "current", materialityScore: 80, confidence: "high", evidenceIds: ["ev:current"] }],
    memoryCandidates: [],
    missingFields: [],
    evidenceCoverage: 1,
    verificationStatus: "verified",
  };
  const prior: PriorSnapshotContext = {
    periodId: "MSFT:2026-03-31:quarter",
    moduleKey: "performance",
    facts: [{ metricKey: "revenue", value: "100", unit: "USDm", basis: "gaap", evidenceIds: ["ev:prior"], confidence: "high", sourceLabel: "fact_source_reported", definitionHash: "v1" }],
    claims: [{ topicKey: "cloud", claimType: "driver", statement: "Cloud was a growth driver.", direction: "neutral", horizon: "current", materialityScore: 60, confidence: "high", evidenceIds: ["ev:prior"] }, { topicKey: "legacy", claimType: "risk", statement: "Legacy demand softened.", direction: "negative", horizon: "current", materialityScore: 55, confidence: "high", evidenceIds: ["ev:prior"] }],
    activeMemory: [],
  };
  const result = compareSnapshots("qoq", current, prior);
  assert.equal(result.metricDeltas[0].percentageDelta, "0.2");
  assert.equal(result.narrativeDeltas.find((delta) => delta.topicKey === "cloud")?.changeType, "strengthened");
  assert.equal(result.narrativeDeltas.find((delta) => delta.topicKey === "legacy")?.changeType, "not_mentioned");
});

class AnalysisMemoryRepository implements SecRepository {
  caches = new Map<string, SecCacheRecord<unknown>>();
  summaries = new Map<string, SecFilingSummary>();
  artifact: SecAnalysisArtifact | null = null;

  async getCache<T>(key: string): Promise<SecCacheRecord<T> | null> {
    return this.caches.get(key) as SecCacheRecord<T> | undefined ?? null;
  }

  async setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void> {
    this.caches.set(key, { payload, fetchedAt });
  }

  async getSummary(): Promise<SecFilingSummary | null> {
    return null;
  }

  async setSummary(summary: SecFilingSummary): Promise<void> {
    this.summaries.set(summary.accessionNumber, summary);
  }

  async getAnalysisContext(filing: SecFiling) {
    const previous = {
      periodId: "MSFT:2025-06-30:quarter",
      moduleKey: "performance" as const,
      facts: [{ metricKey: "revenue", value: "100", unit: "USDm", basis: "gaap" as const, evidenceIds: ["ev:prior"], confidence: "high" as const, sourceLabel: "fact_source_reported" as const }],
      claims: [],
      activeMemory: [],
    };
    return {
      currentPeriodId: `${filing.ticker}:${filing.reportDate}:quarter`,
      qoqPeriodId: previous.periodId,
      yoyPeriodId: previous.periodId,
      qoq: Object.fromEntries(["performance", "segments_and_kpis", "margins_and_costs", "cash_and_capital", "guidance_and_tone", "risks_and_controls", "capital_allocation"].map((moduleKey) => [moduleKey, { ...previous, moduleKey }])) as never,
      yoy: Object.fromEntries(["performance", "segments_and_kpis", "margins_and_costs", "cash_and_capital", "guidance_and_tone", "risks_and_controls", "capital_allocation"].map((moduleKey) => [moduleKey, { ...previous, moduleKey }])) as never,
      activeMemory: [],
    };
  }

  async saveAnalysis(artifact: SecAnalysisArtifact): Promise<void> {
    this.artifact = artifact;
  }
}

test("runs router, module, comparison, and summary stages with qoq/yoy output", async () => {
  const repository = new AnalysisMemoryRepository();
  const company = { fields: ["cik", "name", "ticker"], data: [[789019, "Microsoft Corp", "MSFT"]] };
  const submissions = { name: "Microsoft Corp", filings: { recent: {
    accessionNumber: ["0000789019-26-000001"], form: ["10-Q"], filingDate: ["2026-07-24"], reportDate: ["2026-06-30"], primaryDocument: ["msft.htm"], primaryDocDescription: ["Quarterly report"], items: [""]
  } } };
  let modelCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("company_tickers_exchange")) return new Response(JSON.stringify(company), { status: 200 });
    if (url.includes("/submissions/")) return new Response(JSON.stringify(submissions), { status: 200 });
    if (url.includes("/Archives/")) return new Response("<h1>Item 7. Management Discussion</h1><p>Revenue 120 USDm. Cloud growth remained strong.</p>", { status: 200 });
    if (!url.includes("api.deepseek.com")) throw new Error(`Unexpected URL ${url}`);
    modelCalls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const userPayload = JSON.parse(body.messages?.[1]?.content ?? "{}");
    if (modelCalls === 1) {
      const blockId = userPayload.inventory[0].blockId;
      const moduleKeys = ["performance", "segments_and_kpis", "margins_and_costs", "cash_and_capital", "guidance_and_tone", "risks_and_controls", "capital_allocation"];
      const content = { selections: moduleKeys.map((moduleKey) => ({ moduleKey, blockIds: [blockId], confidence: 0.95 })) };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }
    if (modelCalls <= 8) {
      const evidenceId = userPayload.current.evidence[0].evidenceId;
      const content = { facts: [{ metricKey: "revenue", value: "120", unit: "USDm", basis: "gaap", sourceLabel: "fact_source_reported", evidenceIds: [evidenceId], confidence: "high" }], claims: [], memoryCandidates: [], missingFields: [], evidenceCoverage: 1 };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }
    const evidenceId = userPayload.moduleSnapshots[0].facts[0].evidenceIds[0];
    const content = { headline: "收入增长保持强劲", keyMetrics: [{ metricKey: "revenue", currentValue: "120", evidenceIds: [evidenceId] }], changes: { qoq: [], yoy: [], guidance: [], risks: [] }, dataQuality: { coverage: 1, warnings: [] } };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  };
  const feed = await refreshSecTicker(repository, "MSFT", { apiKey: "test-key", model: "test-model", userAgent: "test", fetcher, now: () => new Date("2026-07-25T00:00:00.000Z"), wait: async () => {} });
  assert.equal(feed.status, "ready");
  assert.ok(repository.artifact);
  assert.equal(repository.artifact?.router.source, "model");
  assert.equal(repository.artifact?.report.keyMetrics[0].qoq, "+20.0%");
  assert.equal(repository.artifact?.report.keyMetrics[0].yoy, "+20.0%");
  assert.equal(repository.artifact?.blocks.length, 1);
  assert.equal(modelCalls, 9);
});
