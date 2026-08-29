import assert from "node:assert/strict";
import test from "node:test";

import {
  FundamentalChartSpecError,
  buildFundamentalChartGeometry,
  buildFundamentalChartModel,
  buildFundamentalChartTooltip,
  getFundamentalSeriesVisual,
  linePath,
  selectFundamentalPeriodTickIndexes,
  toggleFundamentalMetricSelection,
} from "../lib/fundamental-chart.ts";
import {
  makeChartResponse,
  makeChartSeries,
} from "./fixtures/fundamental-chart.ts";

test("auto-assigns currency bars and percentage lines to separate axes", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue" },
    { metricKey: "gross_margin" },
  ]);

  assert.equal(model.axes.length, 2);
  assert.deepEqual(model.series.map((series) => [series.metricKey, series.mark, series.axis]), [
    ["total_revenue", "bar", "left"],
    ["gross_margin", "line", "right"],
  ]);
  assert.equal(model.axes[0]?.key, "currency:USD");
  assert.equal(model.axes[1]?.key, "percent");
  assert.equal(model.axes[1]?.includeZero, true);
});

test("computes QoQ and YoY growth without inventing values across missing or zero comparisons", () => {
  const data = makeChartResponse();
  const qoq = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue", transform: "qoq_growth", mark: "line" },
  ]).series[0]!;
  const yoy = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue", transform: "yoy_growth", mark: "line" },
  ]).series[0]!;

  assert.deepEqual(qoq.points.map((point) => point.value), [null, 20, -25, null, null, 20]);
  assert.deepEqual(yoy.points.map((point) => point.value), [null, null, null, null, 50, 50]);

  const zeroBase = makeChartSeries("total_revenue", [0, 20, 30, 40, 50, 60]);
  const zeroData = makeChartResponse([zeroBase]);
  const zeroModel = buildFundamentalChartModel(zeroData.periods, zeroData.series, [
    { metricKey: "total_revenue", transform: "qoq_growth" },
  ]);
  assert.equal(zeroModel.series[0]?.points[1]?.value, null);
});

test("computes margin change in percentage points", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "gross_margin", transform: "qoq_change" },
  ]);

  assert.deepEqual(model.series[0]?.points.map((point) => point.value), [null, 2, -1, 2, 1, 1]);
  assert.equal(model.series[0]?.unit, "percentage_point");
  assert.equal(model.series[0]?.label, "毛利率 · 环比变化");
});

test("uses capital-expenditure magnitude for presentation while retaining the source decimal", () => {
  const data = makeChartResponse([makeChartSeries("capital_expenditure")]);
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "capital_expenditure" },
  ]);

  assert.deepEqual(model.series[0]?.points.map((point) => point.value), [
    4_000_000,
    5_000_000,
    3_000_000,
    6_000_000,
    7_000_000,
    8_000_000,
  ]);
  assert.equal(model.series[0]?.points[0]?.sourceValueDecimal, "-4000000");
});

test("rejects more than four series and more than two unit families", () => {
  const data = makeChartResponse();
  assert.throws(
    () => buildFundamentalChartModel(data.periods, data.series, [
      { metricKey: "total_revenue" },
      { metricKey: "gross_margin" },
      { metricKey: "operating_income" },
      { metricKey: "free_cash_flow" },
      { metricKey: "diluted_eps" },
    ]),
    (error: unknown) => error instanceof FundamentalChartSpecError && error.code === "TOO_MANY_SERIES",
  );
  assert.throws(
    () => buildFundamentalChartModel(data.periods, data.series, [
      { metricKey: "total_revenue" },
      { metricKey: "diluted_eps" },
      { metricKey: "ordinary_shares" },
    ]),
    (error: unknown) => error instanceof FundamentalChartSpecError && error.code === "TOO_MANY_AXES",
  );
});

test("rejects conflicting explicit axis assignments", () => {
  const data = makeChartResponse();
  assert.throws(
    () => buildFundamentalChartModel(data.periods, data.series, [
      { metricKey: "total_revenue", axis: "left" },
      { metricKey: "gross_margin", axis: "left" },
    ]),
    (error: unknown) => error instanceof FundamentalChartSpecError && error.code === "AXIS_CONFLICT",
  );
});

test("bar domains include zero and negative bars cross the zero baseline", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "operating_income", mark: "bar" },
  ]);
  const geometry = buildFundamentalChartGeometry(model);
  const negativeBar = geometry.bars.find((bar) => bar.value < 0);

  assert.ok(model.axes[0]!.domain[0] <= 0);
  assert.ok(model.axes[0]!.domain[1] >= 0);
  assert.ok(negativeBar);
  assert.equal(negativeBar.y, negativeBar.zeroY);
  assert.ok(negativeBar.height > 0);
});

test("line geometry keeps missing periods as real gaps", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue", mark: "line" },
  ]);
  const geometry = buildFundamentalChartGeometry(model);

  assert.deepEqual(geometry.lines[0]?.segments.map((segment) => segment.length), [3, 2]);
  assert.match(linePath(geometry.lines[0]!.segments[0]!), /^M/);
  assert.doesNotMatch(linePath(geometry.lines[0]!.segments[0]!), /NaN/);
});

test("recomputes plot geometry for a mobile-width container", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue" },
    { metricKey: "gross_margin" },
  ]);
  const desktop = buildFundamentalChartGeometry(model, 760, 360);
  const mobile = buildFundamentalChartGeometry(model, 360, 340);

  assert.equal(mobile.layout.width, 360);
  assert.equal(mobile.layout.height, 340);
  assert.ok(mobile.layout.periodStep < desktop.layout.periodStep);
  assert.ok(mobile.layout.plotLeft >= 70);
  assert.ok(mobile.layout.plotWidth > 220);
});

test("keeps every period label when space permits and thins dense mobile labels deterministically", () => {
  assert.deepEqual(selectFundamentalPeriodTickIndexes(5, 280), [0, 1, 2, 3, 4]);
  assert.deepEqual(selectFundamentalPeriodTickIndexes(8, 280), [0, 2, 4, 7]);
  assert.deepEqual(selectFundamentalPeriodTickIndexes(12, 280), [0, 3, 6, 11]);
  assert.deepEqual(selectFundamentalPeriodTickIndexes(0, 280), []);
});

test("tooltip payload exposes every selected value and honest missing data", () => {
  const data = makeChartResponse();
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "total_revenue" },
    { metricKey: "gross_margin" },
  ]);
  const tooltip = buildFundamentalChartTooltip(model, 3);

  assert.equal(tooltip.periodEnd, "2024-12-31");
  assert.equal(tooltip.rows[0]?.formattedValue, "暂无数据");
  assert.equal(tooltip.rows[1]?.formattedValue, "43%");
  assert.match(tooltip.accessibleLabel, /营收 暂无数据/);
});

test("series visuals use redundant color, line, point, and bar-pattern encodings", () => {
  const visuals = Array.from({ length: 4 }, (_, index) => getFundamentalSeriesVisual(index));
  assert.equal(new Set(visuals.map((visual) => visual.color)).size, 4);
  assert.equal(new Set(visuals.map((visual) => visual.pointShape)).size, 4);
  assert.equal(new Set(visuals.map((visual) => visual.barPattern)).size, 4);
  assert.equal(visuals[0]?.dashArray, undefined);
  assert.ok(visuals.slice(1).every((visual) => visual.dashArray));
});

test("metric selection remains controlled and enforces its maximum", () => {
  assert.deepEqual(toggleFundamentalMetricSelection(["total_revenue"], "gross_margin", true), [
    "total_revenue",
    "gross_margin",
  ]);
  assert.deepEqual(toggleFundamentalMetricSelection(
    ["total_revenue", "gross_margin", "operating_income", "free_cash_flow"],
    "diluted_eps",
    true,
  ), ["total_revenue", "gross_margin", "operating_income", "free_cash_flow"]);
  assert.deepEqual(toggleFundamentalMetricSelection(["total_revenue", "gross_margin"], "gross_margin", false), [
    "total_revenue",
  ]);
});
