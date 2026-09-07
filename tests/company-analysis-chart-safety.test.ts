import assert from "node:assert/strict";
import test from "node:test";

import { buildFundamentalChartModel } from "../lib/web/fundamental-chart.ts";
import { FUNDAMENTAL_METRIC_CATALOG } from "../lib/web/fundamental-metrics.ts";
import { normalizeCompanyAnalysisOverview } from "../workers/pipeline/src/company-analysis/contracts.ts";
import { makeChartResponse } from "./fixtures/fundamental-chart.ts";
import type { PublicFundamentalsResponse } from "../shared/analysis-contract/fundamentals.ts";
import type { ReportChartBlock } from "../shared/analysis-contract/report-blocks.ts";

type ChartSeries = ReportChartBlock["series"];

/**
 * The seam the architecture boundary keeps apart.
 *
 * `buildFundamentalChartModel` throws on an empty series, too many series, an unknown metric, an
 * unsupported transform, a duplicate metric-and-transform, or a third axis unit. It catches its own
 * throw and renders 「这组指标暂时不能叠加」 — wording for someone picking metrics interactively, not
 * something to publish inside an analysis. The Pipeline settles what it can know and the page drops
 * what only it can know, and neither service can import the other to check they agree. A test can.
 *
 * Everything below asserts one property: a chart that survives publication renders. Nothing here
 * asserts what the chart looks like.
 */

const response = makeChartResponse();
const inResponse = response.series.filter((series) => series.available).map((series) => series.metricKey);
const absentFromResponse = Object.keys(FUNDAMENTAL_METRIC_CATALOG).filter((key) => !inResponse.includes(key as never));

/** The page's own filter: only the response knows which metrics it actually carries. */
function renderable(series: ChartSeries, data: PublicFundamentalsResponse): ChartSeries {
  return series.filter((entry) => data.series.some(
    (candidate) => candidate.metricKey === entry.metricKey && candidate.available,
  ));
}

function publish(chartSeries: unknown, chartMetricKeys: ReadonlySet<string>) {
  const overview = normalizeCompanyAnalysisOverview({
    headline: "前瞻判断", introduction: "背景。",
    highlights: [
      { title: "判断一", body: "正文。", evidenceRefs: ["e1"], blocks: [{ type: "chart", title: "图", series: chartSeries }] },
      { title: "判断二", body: "正文。", evidenceRefs: ["e2"] },
    ],
  }, { chartMetricKeys });
  const block = overview.highlights[0]!.blocks?.[0];
  return block?.type === "chart" ? block.series : null;
}

/** Every metric the run observed, which in production is the feature pack — not this response. */
const everyMetric = new Set(Object.keys(FUNDAMENTAL_METRIC_CATALOG));

function assertRenders(chartSeries: unknown, label: string) {
  const published = publish(chartSeries, everyMetric);
  if (!published) return;
  const drawable = renderable(published, response);
  if (drawable.length === 0) return;
  assert.doesNotThrow(
    () => buildFundamentalChartModel(response.periods, response.series, drawable),
    `published chart failed to render: ${label}`,
  );
}

test("every combination of available metrics that survives publication renders", () => {
  let published = 0;
  for (let mask = 1; mask < 1 << inResponse.length; mask += 1) {
    const chosen = inResponse.filter((_, index) => mask & (1 << index));
    for (const transform of ["value", "yoy_growth", undefined]) {
      const series = chosen.map((metricKey) => ({ metricKey, ...(transform ? { transform } : {}) }));
      assertRenders(series, `${chosen.join("+")} @ ${transform ?? "default"}`);
      published += 1;
    }
  }
  // The sweep has to have exercised something, or the assertions above proved nothing.
  assert.equal(published, ((1 << inResponse.length) - 1) * 3);
});

test("a mixed-unit chart is trimmed to two axes rather than published as an error panel", () => {
  // Currency, percent and per-share are three axis units; the renderer refuses the third.
  const series = publish(
    [{ metricKey: "total_revenue" }, { metricKey: "gross_margin" }, { metricKey: "diluted_eps" }],
    everyMetric,
  );
  assert.equal(series?.length, 2);
  assert.doesNotThrow(() => buildFundamentalChartModel(response.periods, response.series, renderable(series!, response)));
});

test("adversarial editorial output never reaches the renderer in a state it refuses", () => {
  const cases: Array<[string, unknown]> = [
    ["empty series", []],
    ["not an array", "total_revenue"],
    ["duplicate metric", [{ metricKey: "total_revenue" }, { metricKey: "total_revenue" }]],
    ["duplicate metric and transform", [{ metricKey: "total_revenue", transform: "value" }, { metricKey: "total_revenue", transform: "value" }]],
    ["more series than a chart holds", inResponse.map((metricKey) => ({ metricKey }))],
    ["unknown metric", [{ metricKey: "ebitda_margin_adjusted" }, { metricKey: "total_revenue" }]],
    ["unsupported transform", [{ metricKey: "total_revenue", transform: "cagr" }]],
    ["axis the protocol no longer has", [{ metricKey: "total_revenue", axis: "right" }, { metricKey: "gross_margin", axis: "right" }]],
    ["metric the run saw but this response does not carry", absentFromResponse.slice(0, 2).map((metricKey) => ({ metricKey }))],
    ["nulls and junk", [null, 42, { metricKey: null }, { metricKey: "total_revenue" }]],
  ];
  for (const [label, series] of cases) assertRenders(series, label);
});

test("a chart the page cannot draw is dropped by the page, not surfaced as a chart error", () => {
  const published = publish(absentFromResponse.slice(0, 2).map((metricKey) => ({ metricKey })), everyMetric);
  // The Pipeline accepts them — they are real metrics the run may well have observed.
  assert.ok(published && published.length > 0);
  // The page holds the only read that knows this response does not carry them.
  assert.equal(renderable(published, response).length, 0);
});
