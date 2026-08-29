import assert from "node:assert/strict";
import test from "node:test";

import {
  FUNDAMENTAL_AI_CHART_PLAN_JSON_SCHEMA,
  FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
  buildDeterministicFundamentalChartPlan,
  buildFundamentalCompanyProfile,
  resolveFundamentalPresentation,
  sliceFundamentalsForChart,
  validateAiFundamentalChartPlan,
} from "../lib/fundamental-chart-plan.ts";
import { makeChartResponse, makeChartSeries } from "./fixtures/fundamental-chart.ts";

function heavyInvestmentData() {
  return makeChartResponse([
    makeChartSeries("total_revenue", [100, 110, 120, 130, 140, 150]),
    makeChartSeries("gross_margin", [40, 41, 42, 41, 40, 39]),
    makeChartSeries("capital_expenditure", [-20, -22, -25, -28, -32, -50]),
    makeChartSeries("free_cash_flow", [12, 11, 10, 8, 5, -2]),
    makeChartSeries("operating_cash_flow", [32, 33, 35, 36, 37, 40]),
  ]);
}

function matureData() {
  return makeChartResponse([
    makeChartSeries("total_revenue", [100, 103, 106, 109, 112, 115]),
    makeChartSeries("gross_margin", [52, 52.5, 53, 53.2, 53.5, 54]),
    makeChartSeries("capital_expenditure", [-2, -2, -2, -2, -2, -2]),
    makeChartSeries("free_cash_flow", [21, 22, 23, 24, 25, 26]),
    makeChartSeries("operating_cash_flow", [25, 26, 27, 28, 29, 30]),
  ]);
}

function validAiCandidate(data = makeChartResponse()) {
  return {
    schemaVersion: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
    ticker: data.ticker,
    inputDataHash: data.dataVersion,
    modelVersion: "fixture-model-v1",
    promptVersion: "fixture-prompt-v1",
    charts: [{
      id: "growth-quality",
      title: "收入增长与毛利率",
      insight: "收入增长的同时观察毛利率变化。",
      periodCount: 5,
      series: [
        { metricKey: "total_revenue", mark: "bar", transform: "value", axis: "left" },
        { metricKey: "gross_margin", mark: "line", transform: "value", axis: "right" },
      ],
    }],
  };
}

test("exports a closed JSON schema for future model structured output", () => {
  assert.equal(FUNDAMENTAL_AI_CHART_PLAN_JSON_SCHEMA.additionalProperties, false);
  assert.equal(FUNDAMENTAL_AI_CHART_PLAN_JSON_SCHEMA.properties.charts.maxItems, 2);
  assert.equal(FUNDAMENTAL_AI_CHART_PLAN_JSON_SCHEMA.properties.charts.items.properties.series.maxItems, 4);
});

test("builds deterministic profiles and only forces capex for materially heavy investment", () => {
  const heavy = buildFundamentalCompanyProfile(heavyInvestmentData());
  const mature = buildFundamentalCompanyProfile(matureData());

  assert.equal(heavy?.classification, "capital_intensive");
  assert.ok((heavy?.features.capitalExpenditureIntensityPct ?? 0) >= 10);
  assert.deepEqual(heavy?.guardrailMetrics, ["capital_expenditure"]);
  assert.equal(mature?.classification, "mature_cash_generator");
  assert.deepEqual(mature?.guardrailMetrics, []);
});

test("deterministic preset adds an investment chart for heavy companies and omits it for mature companies", () => {
  const heavyPlan = buildDeterministicFundamentalChartPlan(heavyInvestmentData());
  const maturePlan = buildDeterministicFundamentalChartPlan(matureData());

  assert.equal(heavyPlan.charts.length, 2);
  assert.ok(heavyPlan.charts[1]?.series.some((series) => series.metricKey === "capital_expenditure"));
  assert.equal(maturePlan.charts.length, 1);
  assert.ok(maturePlan.charts.every((chart) =>
    chart.series.every((series) => series.metricKey !== "capital_expenditure")));
});

test("validates a source-bound AI plan and records model and prompt provenance", () => {
  const data = makeChartResponse();
  const validation = validateAiFundamentalChartPlan(validAiCandidate(data), data);

  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.deepEqual(validation.plan.provenance, {
    kind: "ai",
    modelVersion: "fixture-model-v1",
    promptVersion: "fixture-prompt-v1",
  });
  assert.equal(validation.plan.charts[0]?.series.length, 2);
});

test("rejects stale hashes, unavailable metrics, third axes, unknown fields, and missing guardrails", () => {
  const ordinary = makeChartResponse();
  const stale = validateAiFundamentalChartPlan({ ...validAiCandidate(ordinary), inputDataHash: "stale" }, ordinary);
  assert.equal(stale.ok, false);
  assert.ok(stale.issues.some((issue) => issue.code === "STALE_INPUT_DATA"));

  const unavailableCandidate = validAiCandidate(ordinary);
  unavailableCandidate.charts[0]!.series[0]!.metricKey = "capital_expenditure";
  const unavailable = validateAiFundamentalChartPlan(unavailableCandidate, ordinary);
  assert.ok(!unavailable.ok && unavailable.issues.some((issue) => issue.code === "UNAVAILABLE_METRIC"));

  const threeAxes = validAiCandidate(ordinary);
  threeAxes.charts[0]!.series.push({ metricKey: "diluted_eps", mark: "line", transform: "value", axis: "left" });
  const axes = validateAiFundamentalChartPlan(threeAxes, ordinary);
  assert.ok(!axes.ok && axes.issues.some((issue) => issue.code === "CHART_SPEC_INVALID"));

  const unknown = { ...validAiCandidate(ordinary), rawYahooField: "quarterlyTotalRevenue" };
  const unknownResult = validateAiFundamentalChartPlan(unknown, ordinary);
  assert.ok(!unknownResult.ok && unknownResult.issues.some((issue) => issue.code === "UNKNOWN_FIELD"));

  const heavy = heavyInvestmentData();
  const missingGuardrail = validateAiFundamentalChartPlan(validAiCandidate(heavy), heavy);
  assert.ok(!missingGuardrail.ok && missingGuardrail.issues.some((issue) => issue.code === "MISSING_GUARDRAIL_METRIC"));
});

test("resolves user, URL, validated AI, and fallback preset in strict priority order", () => {
  const data = makeChartResponse();
  const pageOverride = { metricKeys: ["free_cash_flow"] as const, chart: "line" as const, periodCount: 8 };

  assert.equal(resolveFundamentalPresentation({
    data,
    userOverride: pageOverride,
    urlOverride: { metricKeys: ["gross_margin"], chart: "bar", periodCount: 5 },
    aiCandidate: validAiCandidate(data),
  }).source, "user");
  assert.equal(resolveFundamentalPresentation({
    data,
    urlOverride: pageOverride,
    aiCandidate: validAiCandidate(data),
  }).source, "url");
  assert.equal(resolveFundamentalPresentation({ data, aiCandidate: validAiCandidate(data) }).source, "ai");

  const fallback = resolveFundamentalPresentation({
    data,
    aiCandidate: { ...validAiCandidate(data), inputDataHash: "stale" },
  });
  assert.equal(fallback.source, "preset");
  assert.ok(fallback.rejectedAiIssues.some((issue) => issue.code === "STALE_INPUT_DATA"));
});

test("legacy URL overrides omit incompatible additions instead of crashing the page", () => {
  const data = makeChartResponse();
  const resolved = resolveFundamentalPresentation({
    data,
    urlOverride: {
      metricKeys: ["total_revenue", "gross_margin", "diluted_eps"],
      chart: "combo",
      periodCount: 5,
    },
  });

  assert.equal(resolved.source, "url");
  assert.deepEqual(
    resolved.plan.charts[0]?.series.map((series) => series.metricKey),
    ["total_revenue", "gross_margin"],
  );
});

test("slices periods without changing the data hash or inventing missing points", () => {
  const data = makeChartResponse();
  const sliced = sliceFundamentalsForChart(data, 5);
  assert.equal(sliced.dataVersion, data.dataVersion);
  assert.deepEqual(sliced.periods.map((period) => period.periodEnd), data.periods.slice(-5).map((period) => period.periodEnd));
  assert.ok(sliced.series.every((series) => series.points.length === 5));
});
