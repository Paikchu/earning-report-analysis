import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FundamentalBarChart,
  FundamentalComboChart,
  FundamentalLineChart,
  MetricSelector,
} from "../components/fundamentals/FundamentalChart";
import {
  makeChartResponse,
  makeChartSeries,
  makePendingChartResponse,
} from "./fixtures/fundamental-chart.ts";

test("combo chart renders semantic SVG, redundant encodings, keyboard targets, status, and data table", () => {
  const data = makeChartResponse();
  const html = renderToStaticMarkup(
    <FundamentalComboChart
      title="ACME 基本面趋势"
      description="营收与毛利率按报告期末对齐。"
      data={data}
      series={[
        { metricKey: "total_revenue" },
        { metricKey: "gross_margin" },
        { metricKey: "operating_income", transform: "yoy_growth", mark: "line" },
      ]}
    />,
  );

  assert.match(html, /data-chart-role="fundamental-chart"/);
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /data-axis-side="left"/);
  assert.match(html, /data-axis-side="right"/);
  assert.match(html, /data-zero-axis="right"/);
  assert.equal((html.match(/data-period-end=/g) ?? []).length, 6);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 7);
  assert.equal((html.match(/role="button"/g) ?? []).length, 6);
  assert.match(html, /stroke-dasharray="/);
  assert.match(html, /<pattern/);
  assert.match(html, /data-chart-role="data-table"/);
  assert.match(html, /<caption class="sr-only">图表中的季度基本面数据<\/caption>/);
  assert.match(html, /数据待更新/);
  assert.match(html, /部分数据/);
  assert.match(html, /来源：Yahoo Finance/);
  assert.match(html, /暂无数据/);
});

test("bar and line wrappers force their public rendering contract", () => {
  const data = makeChartResponse();
  const barHtml = renderToStaticMarkup(
    <FundamentalBarChart title="柱状图" data={data} series={[{ metricKey: "gross_margin" }]} />,
  );
  const lineHtml = renderToStaticMarkup(
    <FundamentalLineChart title="折线图" data={data} series={[{ metricKey: "total_revenue" }]} />,
  );

  assert.match(barHtml, /class="fundamental-chart__bar"/);
  assert.doesNotMatch(barHtml, /class="fundamental-chart__line"/);
  assert.match(lineHtml, /class="fundamental-chart__line"/);
  assert.doesNotMatch(lineHtml, /class="fundamental-chart__bar"/);
});

test("pending and invalid configurations render explicit fallback states", () => {
  const pendingHtml = renderToStaticMarkup(
    <FundamentalComboChart title="等待数据" data={makePendingChartResponse()} series={[{ metricKey: "total_revenue" }]} />,
  );
  const invalidHtml = renderToStaticMarkup(
    <FundamentalComboChart
      title="单位过多"
      data={makeChartResponse()}
      series={[
        { metricKey: "total_revenue" },
        { metricKey: "diluted_eps" },
        { metricKey: "ordinary_shares" },
      ]}
    />,
  );

  assert.match(pendingHtml, /财报趋势正在准备/);
  assert.match(pendingHtml, /图表会自动更新/);
  assert.doesNotMatch(pendingHtml, /role="img"/);
  assert.match(invalidHtml, /超过两种不可共用的单位/);
  assert.doesNotMatch(invalidHtml, /role="img"/);
});

test("metric selector exposes real checkboxes and disables unavailable or over-limit additions", () => {
  const unavailable = makeChartSeries("diluted_eps", [null, null, null, null, null, null]);
  const series = [
    makeChartSeries("total_revenue"),
    makeChartSeries("gross_margin"),
    makeChartSeries("operating_income"),
    makeChartSeries("free_cash_flow"),
    unavailable,
  ];
  const html = renderToStaticMarkup(
    <MetricSelector
      availableSeries={series}
      selectedMetricKeys={["total_revenue", "gross_margin", "operating_income", "free_cash_flow"]}
      onChange={() => undefined}
    />,
  );

  assert.match(html, /<fieldset[^>]*data-chart-role="metric-selector"/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 5);
  assert.equal((html.match(/checked=""/g) ?? []).length, 4);
  assert.match(html, /data-available="false"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /已达到叠加上限/);
});

test("metric selector prevents adding a third incompatible axis", () => {
  const html = renderToStaticMarkup(
    <MetricSelector
      availableSeries={[
        makeChartSeries("total_revenue"),
        makeChartSeries("gross_margin"),
        makeChartSeries("diluted_eps"),
      ]}
      selectedMetricKeys={["total_revenue", "gross_margin"]}
      onChange={() => undefined}
    />,
  );

  assert.match(html, /data-compatible="false"/);
  assert.match(html, /单位冲突/);
});
