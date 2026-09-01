import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFilingBlocks,
  buildSecAnalysisBrief,
  normalizeAnalysisFacts,
  type SecHistorySnapshot,
} from "../lib/sec-analysis.ts";
import { formatSecMetricLabel, formatSecMetricValue } from "../lib/sec-metric-format.ts";

const blocks = buildFilingBlocks([
  "Item 1. Business",
  "The company operates a cloud platform.",
  "Item 7. Management Discussion",
  "Revenue increased 20% and operating margin expanded.",
  "Item 8. Financial Statements",
  "Revenue 76,400; operating income 30,100.",
].join("\n"), "acc-1");

const evidenceId = `ev:${blocks[2].blockId}`;

test("builds stable filing blocks with numeric density and evidence-sized previews", () => {
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].heading, "Item 8. Financial Statements");
  assert.ok(blocks[2].numericDensity > 0);
  assert.equal(blocks[2].blockId.startsWith("acc-1:block:"), true);
});

test("blocks record the span they occupy in the source text", () => {
  const source = [
    "Item 1. Business",
    "The company operates a cloud platform.",
    "Item 7. Management Discussion",
    "Revenue increased 20% and operating margin expanded.",
  ].join("\n");
  const built = buildFilingBlocks(source, "acc-2");

  for (const block of built) {
    assert.ok(block.end > block.start, `${block.blockId} must span forward`);
    // Whitespace is normalized inside a block, so compare on the collapsed form.
    const slice = source.slice(block.start, block.end).replace(/\s+/g, " ").trim();
    assert.equal(slice, block.body.replace(/\n/g, " "));
  }
  assert.ok(built[0].end <= built[1].start, "block spans must not overlap");
});

test("splits umbrella business KPIs by normalized definition", () => {
  const facts = normalizeAnalysisFacts([
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
  ], new Set([evidenceId]));

  assert.deepEqual(facts.map((fact) => fact.metricKey), [
    "geographic_revenue_by_customer_headquarters",
    "revenue_from_customers_headquartered_outside",
  ]);
  assert.equal(facts[0].periodScope, "quarterly_and_half_yearly");
  assert.notEqual(facts[0].definitionHash, facts[1].definitionHash);
  assert.match(facts[0].definitionHash ?? "", /^[0-9a-f]{8}$/);
  assert.equal(facts[1].currency, "");
});

test("node facts cannot cite evidence outside the analysed filing", () => {
  const facts = normalizeAnalysisFacts([
    { metricKey: "segment_revenue", value: "76400", unit: "USDm", basis: "gaap", evidenceIds: [evidenceId, "ev:other-filing"], confidence: "high" },
    { metricKey: "backlog", value: "12000", unit: "USDm", basis: "gaap", evidenceIds: ["ev:other-filing"], confidence: "high" },
  ], new Set([evidenceId]));

  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].evidenceIds, [evidenceId]);
});

test("normalizes a valid raw block ID into its evidence ID", () => {
  const facts = normalizeAnalysisFacts(
    [{ metricKey: "segment_revenue", value: "76400", unit: "USDm", basis: "gaap", evidenceIds: [blocks[2].blockId], confidence: "high" }],
    new Set([evidenceId]),
  );

  assert.deepEqual(facts[0].evidenceIds, [evidenceId]);
});

function observation(seriesId: string, endDate: string, value: string) {
  return {
    observationId: `xbrl:${seriesId}:${endDate}`,
    seriesId: seriesId as never,
    metricKey: seriesId,
    value,
    unit: "USD",
    currency: "USD",
    basis: "gaap" as const,
    periodScope: "quarter" as const,
    startDate: endDate,
    endDate,
    sourceAccession: "acc-1",
    sourceFiledAt: endDate,
    sourceVersion: "sec-canonical-series.v1",
    qualityStatus: "validated_xbrl" as const,
    xbrlConcept: `us-gaap:${seriesId}`,
  };
}

const history: SecHistorySnapshot = {
  registryVersion: "sec-canonical-series.v1",
  series: [{
    seriesId: "revenue",
    quarters: [
      observation("revenue", "2026-06-30", "120"),
      observation("revenue", "2026-03-31", "100"),
      observation("revenue", "2025-06-30", "96"),
    ],
    annual: [],
  }],
};

test("derives current facts and both comparisons from XBRL alone", () => {
  const brief = buildSecAnalysisBrief({
    ticker: "MSFT",
    filingId: "acc-1",
    periodId: "MSFT:2026-06-30:quarter",
    periodScope: "quarter",
    reportDate: "2026-06-30",
    history,
    memorySummary: "",
    memoryItems: [],
  });

  assert.deepEqual(brief.currentFacts.map((fact) => [fact.metricKey, fact.value, fact.unit]), [["revenue", "120", "USD"]]);
  assert.deepEqual(brief.currentFacts[0].evidenceIds, ["xbrl:revenue:2026-06-30"]);
  assert.equal(brief.comparisons.find((item) => item.comparisonType === "qoq")?.percentageDelta, "0.2");
  assert.equal(brief.comparisons.find((item) => item.comparisonType === "yoy")?.percentageDelta, "0.25");
  assert.ok(brief.allowedMetricKeys.includes("free_cash_flow"));
});

test("measures a margin in percentage points and an amount in percent", () => {
  const margin = (endDate: string, value: string) => ({
    ...observation("operating_margin", endDate, value),
    unit: "ratio",
    currency: undefined,
    basis: "derived" as const,
  });
  const brief = buildSecAnalysisBrief({
    ticker: "NET",
    filingId: "acc-1",
    periodId: "NET:2026-06-30:quarter",
    periodScope: "quarter",
    reportDate: "2026-06-30",
    history: {
      registryVersion: "sec-canonical-series.v1",
      series: [
        { seriesId: "operating_margin", quarters: [margin("2026-06-30", "-0.2955143299222338"), margin("2026-03-31", "-0.09690272057271924")], annual: [] },
        { seriesId: "revenue", quarters: [observation("revenue", "2026-06-30", "696061000"), observation("revenue", "2026-03-31", "639755000")], annual: [] },
      ],
    },
    memorySummary: "",
    memoryItems: [],
  });
  const find = (seriesId: string) => brief.comparisons.find((item) => item.seriesId === seriesId && item.comparisonType === "qoq");

  // -9.69% to -29.55% is 19.9 points worse. The relative form reads -205%, which is why a ratio
  // needs its own delta rather than the one every amount uses.
  assert.equal(Number(find("operating_margin")?.percentagePointDelta).toFixed(4), "-0.1986");
  assert.equal(Number(find("operating_margin")?.percentageDelta).toFixed(2), "-2.05");
  // An amount has no percentage points to move, so it carries the relative delta alone.
  assert.equal(find("revenue")?.percentagePointDelta, undefined);
  assert.equal(Number(find("revenue")?.percentageDelta).toFixed(4), "0.0880");
});

test("compares a differenced quarter against the directly reported quarter before it", () => {
  // A cash flow series mixes bases: Q1 is tagged directly, later quarters are recovered from
  // year-to-date facts. The comparison must still use the immediately preceding quarter.
  const mixed: SecHistorySnapshot = {
    registryVersion: "sec-canonical-series.v1",
    series: [{
      seriesId: "operating_cash_flow",
      quarters: [
        { ...observation("operating_cash_flow", "2026-06-30", "4697"), basis: "derived" },
        observation("operating_cash_flow", "2026-03-31", "3937"),
        { ...observation("operating_cash_flow", "2025-09-30", "6238"), basis: "derived" },
        { ...observation("operating_cash_flow", "2025-06-30", "2540"), basis: "derived" },
      ],
      annual: [],
    }],
  };
  const brief = buildSecAnalysisBrief({
    ticker: "TSLA", filingId: "acc-1", periodId: "TSLA:2026-06-30:quarter", periodScope: "quarter",
    reportDate: "2026-06-30", history: mixed, memorySummary: "", memoryItems: [],
  });

  const qoq = brief.comparisons.find((item) => item.comparisonType === "qoq");
  assert.equal(qoq?.priorEndDate, "2026-03-31", "must not skip the gaap quarter and reach back three quarters");
  assert.equal(brief.comparisons.find((item) => item.comparisonType === "yoy")?.priorEndDate, "2025-06-30");
});

test("does not label a gap of several quarters as a quarter-over-quarter change", () => {
  const gapped: SecHistorySnapshot = {
    registryVersion: "sec-canonical-series.v1",
    series: [{
      seriesId: "revenue",
      quarters: [observation("revenue", "2026-06-30", "120"), observation("revenue", "2025-09-30", "80")],
      annual: [],
    }],
  };
  const brief = buildSecAnalysisBrief({
    ticker: "MSFT", filingId: "acc-1", periodId: "MSFT:2026-06-30:quarter", periodScope: "quarter",
    reportDate: "2026-06-30", history: gapped, memorySummary: "", memoryItems: [],
  });

  assert.equal(brief.comparisons.some((item) => item.comparisonType === "qoq"), false);
});

test("reports series the filing period has no XBRL value for instead of guessing", () => {
  const brief = buildSecAnalysisBrief({
    ticker: "MSFT",
    filingId: "acc-1",
    periodId: "MSFT:2026-09-30:quarter",
    periodScope: "quarter",
    reportDate: "2026-09-30",
    history,
    memorySummary: "",
    memoryItems: [],
  });

  assert.deepEqual(brief.currentFacts, []);
  assert.deepEqual(brief.missingSeriesIds, ["revenue"]);
  assert.deepEqual(brief.comparisons, []);
});

test("timeline metric formatting turns stored magnitudes into readable figures", () => {
  assert.equal(formatSecMetricLabel("revenue"), "营收");
  assert.equal(formatSecMetricLabel("gross_margin"), "毛利率");
  // Unknown keys still read as words rather than snake_case.
  assert.equal(formatSecMetricLabel("segment_backlog"), "segment backlog");

  assert.equal(formatSecMetricValue("revenue", "96221000000"), "962.2 亿");
  assert.equal(formatSecMetricValue("net_income", "-25000000"), "-2500.0 万");
  // Ratios arrive either as a fraction or as an already-scaled percentage.
  assert.equal(formatSecMetricValue("gross_margin", "0.7497531724"), "75.0%");
  assert.equal(formatSecMetricValue("operating_margin", "66.2"), "66.2%");
  assert.equal(formatSecMetricValue("diluted_eps", "2.42"), "2.42");
  // Anything the model wrote as prose is left alone.
  assert.equal(formatSecMetricValue("revenue", "962.2 亿美元"), "962.2 亿美元");
  assert.equal(formatSecMetricValue("long_term_debt", "not disclosed"), "not disclosed");
});
