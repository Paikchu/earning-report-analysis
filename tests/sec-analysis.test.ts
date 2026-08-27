import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFilingBlocks,
  buildModulePayload,
  buildRouterPayload,
  compareSnapshots,
  normalizeModuleAnalysis,
  normalizeRouterResult,
  type PriorSnapshotContext,
  type SnapshotSummary,
} from "../lib/sec-analysis.ts";

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

test("router merges repeated selections for the same analysis module", () => {
  const result = normalizeRouterResult({
    selections: [
      { moduleKey: "performance", blockIds: [blocks[1].blockId], expectedFields: ["revenue"], priority: "high", confidence: 0.9 },
      { moduleKey: "performance", blockIds: [blocks[2].blockId], expectedFields: ["operating_income"], priority: "medium", confidence: 0.8 },
    ],
  }, blocks);

  assert.equal(result.selections.length, 1);
  assert.deepEqual(result.selections[0].blockIds, [blocks[1].blockId, blocks[2].blockId]);
  assert.deepEqual(result.selections[0].expectedFields, ["revenue", "operating_income"]);
});

test("module payload gives the model the exact persisted JSON contract", () => {
  const payload = buildModulePayload({
    moduleKey: "performance",
    filing: { ticker: "MSFT", form: "10-K", reportDate: "2026-06-30", accessionNumber: "acc-1" },
    currentBlocks: [blocks[2]],
    currentFacts: [],
    activeMemory: [],
    precomputedDeltas: [],
  });

  assert.deepEqual(payload.outputSchema.facts, [{
    metricKey: "specific_snake_case_metric_key",
    definition: "stable English metric definition without period or value",
    value: "string",
    unit: "string",
    currency: "string",
    periodScope: "string",
    basis: "gaap|non_gaap|management_kpi|derived|unknown",
    evidenceIds: ["ev:<supplied blockId>"],
    confidence: "high|medium|low",
    sourceLabel: "fact_source_reported|management_adjusted|derived_calculation|unknown",
  }]);
  assert.ok(payload.rules.some((rule) => rule.includes("never return business_kpi")));
});

test("splits umbrella business KPIs by normalized definition", () => {
  const evidenceId = `ev:${blocks[2].blockId}`;
  const result = normalizeModuleAnalysis({
    facts: [
      {
        metricKey: "business_kpi",
        definition: "Geographic revenue by customer headquarters",
        value: "United States $60,074 million",
        unit: "USD millions",
        currency: "USD",
        periodScope: "quarterly_and_half_yearly",
        basis: "management_kpi",
        evidenceIds: [evidenceId],
      },
      {
        metricKey: "business_kpi",
        definition: "Revenue from customers headquartered outside the United States",
        value: "38%",
        unit: "percent",
        currency: "USD",
        periodScope: "quarterly_and_half_yearly",
        basis: "management_kpi",
        evidenceIds: [evidenceId],
      },
    ],
  }, "segments_and_kpis", new Set([evidenceId]));

  assert.deepEqual(result.facts.map((fact) => fact.metricKey), [
    "geographic_revenue_by_customer_headquarters",
    "revenue_from_customers_headquartered_outside_the_united_states",
  ]);
  assert.equal(result.facts[0].periodScope, "quarterly_and_half_yearly");
  assert.notEqual(result.facts[0].definitionHash, result.facts[1].definitionHash);
  assert.match(result.facts[0].definitionHash ?? "", /^[0-9a-f]{8}$/);
  assert.equal(result.facts[1].currency, "");
});

test("bounds the dynamic router inventory for large annual filings", () => {
  const largeBlocks = Array.from({ length: 700 }, (_, index) => ({
    ...blocks[0],
    blockId: `block-${index}`,
    ordinal: index,
    numericDensity: index % 17,
  }));
  const payload = buildRouterPayload({
    ticker: "MSFT",
    form: "10-K",
    filingDate: "2026-07-30",
    reportDate: "2026-06-30",
    accessionNumber: "annual",
  }, largeBlocks, []);

  assert.ok(payload.inventory.length <= 240);
  assert.equal(payload.inventory.some((item) => item.blockId === "block-0"), true);
  assert.equal(payload.inventory.some((item) => item.blockId === "block-699"), true);
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

test("normalizes a valid raw block ID into its evidence ID", () => {
  const evidenceId = `ev:${blocks[2].blockId}`;
  const result = normalizeModuleAnalysis({
    facts: [{ metricKey: "revenue", value: "76400", unit: "USDm", basis: "gaap", evidenceIds: [blocks[2].blockId], confidence: "high" }],
    evidenceCoverage: 1,
  }, "performance", new Set([evidenceId]));

  assert.deepEqual(result.facts[0].evidenceIds, [evidenceId]);
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
