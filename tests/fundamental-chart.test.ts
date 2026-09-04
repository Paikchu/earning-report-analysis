import assert from "node:assert/strict";
import test from "node:test";

import {
  FUNDAMENTAL_NOT_MEANINGFUL_HINT,
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
  // 空着的格子都源于缺数据：首期没有上一期，2024-12 缺营收又拖累它自己和下一期。
  assert.deepEqual(qoq.points.map((point) => point.unavailableReason), [
    "missing",
    null,
    null,
    "missing",
    "missing",
    null,
  ]);

  const zeroBase = makeChartSeries("total_revenue", [0, 20, 30, 40, 50, 60]);
  const zeroData = makeChartResponse([zeroBase]);
  const zeroModel = buildFundamentalChartModel(zeroData.periods, zeroData.series, [
    { metricKey: "total_revenue", transform: "qoq_growth" },
  ]);
  assert.equal(zeroModel.series[0]?.points[1]?.value, null);
  // 基数为 0 不是缺数据：两期都有数，只是这个比值没有意义。
  assert.equal(zeroModel.series[0]?.points[1]?.unavailableReason, "not_meaningful");
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

test("matches YoY comparison by periodEnd when an excluded quarter leaves a hole", () => {
  // 8 个季度中的第 5 个（2024-06-30）被 normalization 剔除，数组出现"空洞"。
  // 旧实现按固定索引偏移（index-4）会把 2024-09 起的同比基准错指到更早的季度。
  const periodEnds = [
    "2023-06-30",
    "2023-09-30",
    "2023-12-31",
    "2024-03-31",
    // 2024-06-30 被剔除
    "2024-09-30",
    "2024-12-31",
    "2025-03-31",
  ];
  const values = [100, 110, 120, 130, 150, 160, 170];
  const series = {
    ...makeChartSeries("total_revenue"),
    points: periodEnds.map((periodEnd, index) => ({
      periodEnd,
      valueDecimal: String(values[index]),
      revision: 1,
    })),
  };
  const periods = periodEnds.map((periodEnd) => ({ periodType: "3M" as const, periodEnd, currency: "USD" }));
  const model = buildFundamentalChartModel(periods, [series], [
    { metricKey: "total_revenue", transform: "yoy_growth", mark: "line" },
  ]);
  const yoy = model.series[0]!;

  // 空洞前的点与旧实现一致（序列不足一年，找不到去年同期 → null）。
  assert.deepEqual(yoy.points.slice(0, 4).map((point) => point.value), [null, null, null, null]);
  // 空洞后的点按 periodEnd 匹配真实去年同期（旧实现会错比 index-4 条目）：
  // 2024-09 vs 2023-09 = (150/110 - 1) * 100 ≈ 36.36
  // 2024-12 vs 2023-12 = (160/120 - 1) * 100 ≈ 33.33
  // 2025-03 vs 2024-03 = (170/130 - 1) * 100 ≈ 30.77
  assert.deepEqual(yoy.points.slice(4).map((point) => point.value), [
    36.3636363636,
    33.3333333333,
    30.7692307692,
  ]);
});

test("leaves QoQ growth undefined when the previous period is negative instead of inverting the sign", () => {
  // 净利润在盈亏之间来回：100 → 150（正增长）→ -100（转亏）→ -150（亏损扩大）
  // → 50（扭亏为盈）→ 120。后三段的基数为负，(cur / base - 1) 会把符号整体翻转：
  // 扭亏为盈会被算成 -133%，亏损扩大反而算成 +50%。这些数字没有数学意义，必须置空。
  const series = makeChartSeries("net_income", [100, 150, -100, -150, 50, 120]);
  const data = makeChartResponse([series]);
  const qoq = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "net_income", transform: "qoq_growth" },
  ]).series[0]!;

  // 正基数照常计算（含正基数转亏），负基数一律为空。
  assert.deepEqual(qoq.points.map((point) => point.value), [null, 50, -166.666666667, null, null, 140]);
  // 三个空格分成两类：首期是没有上一期可比，后两个是基数为负——页面据此分别显示
  // 「—」和「NM」，扭亏为盈不再和缺数据同形。
  assert.deepEqual(qoq.points.map((point) => point.unavailableReason), [
    "missing",
    null,
    null,
    "not_meaningful",
    "not_meaningful",
    null,
  ]);

  // 差值型变换（百分点）与基数符号无关，跨零仍然成立，不能被这次修复误伤。
  const margin = makeChartSeries("gross_margin", [10, 15, -10, -15, 5, 12]);
  const change = buildFundamentalChartModel(makeChartResponse([margin]).periods, [margin], [
    { metricKey: "gross_margin", transform: "qoq_change" },
  ]).series[0]!;
  assert.deepEqual(change.points.map((point) => point.value), [null, 5, -25, -5, 20, 7]);
});

test("leaves YoY growth undefined when the year-ago period is negative", () => {
  // 2024-03 亏损 -100，2025-03 转正 50：同比增速不存在，页面应显示「—」而不是 -150%。
  // 2025-06 的基数（150）为正，仍照常计算。
  const series = makeChartSeries("net_income", [-100, 150, 200, 300, 50, 120]);
  const data = makeChartResponse([series]);
  const yoy = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "net_income", transform: "yoy_growth" },
  ]).series[0]!;

  assert.deepEqual(yoy.points.map((point) => point.value), [null, null, null, null, null, -20]);
  // 前四期是序列不足一年（缺数据），2025-03 才是去年同期为负的那一格。
  assert.deepEqual(yoy.points.map((point) => point.unavailableReason), [
    "missing",
    "missing",
    "missing",
    "missing",
    "not_meaningful",
    null,
  ]);
});

test("tooltip separates a meaningless growth rate from missing data", () => {
  const series = makeChartSeries("net_income", [100, 150, -100, -150, 50, 120]);
  const data = makeChartResponse([series]);
  const model = buildFundamentalChartModel(data.periods, data.series, [
    { metricKey: "net_income", transform: "qoq_growth" },
  ]);

  // 2024-12 的基数是 -100：有数据，但这个增速没有意义。
  const notMeaningful = buildFundamentalChartTooltip(model, 3);
  assert.equal(notMeaningful.rows[0]?.unavailableReason, "not_meaningful");
  assert.equal(notMeaningful.rows[0]?.formattedValue, "NM");
  // 缩写只在窄处出现；朗读的那份把它展开，否则读屏只会念出两个字母。
  assert.match(notMeaningful.accessibleLabel, new RegExp(FUNDAMENTAL_NOT_MEANINGFUL_HINT));

  // 首期没有上一期可比，仍然是「暂无数据」。
  const missing = buildFundamentalChartTooltip(model, 0);
  assert.equal(missing.rows[0]?.unavailableReason, "missing");
  assert.equal(missing.rows[0]?.formattedValue, "暂无数据");

  // 有数字的一格不带任何原因，不能被当成缺失。
  const present = buildFundamentalChartTooltip(model, 1);
  assert.equal(present.rows[0]?.unavailableReason, null);
  assert.equal(present.rows[0]?.formattedValue, "50%");
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
