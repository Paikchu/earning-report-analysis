import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FundamentalChartsView } from "../app/stocks/[ticker]/FundamentalCharts";
import { resolveFundamentalPresentation } from "../lib/fundamental-chart-plan.ts";
import type { FundamentalPageState } from "../lib/fundamental-page-state.ts";
import { makeChartResponse, makeChartSeries } from "./fixtures/fundamental-chart.ts";

const pageState: FundamentalPageState = {
  metricKeys: ["total_revenue", "gross_margin"],
  chart: "combo",
  periodCount: 5,
};

const callbacks = {
  onMetricKeysChange: () => undefined,
  onChartChange: () => undefined,
  onPeriodCountChange: () => undefined,
  onRetry: () => undefined,
};

test("stock fundamentals workbench renders one chart, explicit controls, and the desktop selector", () => {
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={makeChartResponse()}
      pageState={pageState}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  assert.match(html, /id="fundamentals-heading"/);
  assert.match(html, /Yahoo Finance · 季度数据/);
  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 1);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 1);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.match(html, /aria-checked="true"[^>]*data-active="true"[^>]*>组合/);
  assert.match(html, /aria-label="显示季度数"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /指标 <span>2<\/span>/);
  assert.match(html, /已连接/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test("request states remain local to the fundamentals surface", () => {
  const loadingHtml = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={null}
      pageState={pageState}
      requestState="loading"
      error={null}
      {...callbacks}
    />,
  );
  const errorHtml = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={null}
      pageState={pageState}
      requestState="error"
      error="模拟的网络故障。"
      {...callbacks}
    />,
  );

  assert.match(loadingHtml, /正在载入基本面趋势/);
  assert.doesNotMatch(loadingHtml, /data-chart-role="fundamental-chart"/);
  assert.match(errorHtml, /基本面数据暂时不可用/);
  assert.match(errorHtml, /模拟的网络故障/);
  assert.match(errorHtml, /重新获取/);
  assert.doesNotMatch(errorHtml, /data-chart-role="fundamental-chart"/);
});

test("line mode forces the shared renderer to draw line marks", () => {
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={makeChartResponse()}
      pageState={{ ...pageState, chart: "line" }}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  assert.match(html, /class="fundamental-chart__line"/);
  assert.doesNotMatch(html, /class="fundamental-chart__bar"/);
});

test("capital-intensive preset renders a protected second chart without changing user controls", () => {
  const data = makeChartResponse([
    makeChartSeries("total_revenue", [100, 110, 120, 130, 140, 150]),
    makeChartSeries("gross_margin", [40, 41, 42, 41, 40, 39]),
    makeChartSeries("capital_expenditure", [-20, -22, -25, -28, -32, -50]),
    makeChartSeries("free_cash_flow", [12, 11, 10, 8, 5, -2]),
  ]);
  const presentation = resolveFundamentalPresentation({ data });
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={data}
      pageState={pageState}
      requestState="ready"
      error={null}
      presentation={presentation}
      {...callbacks}
    />,
  );

  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 2);
  assert.match(html, /data-presentation-source="preset"/);
  assert.match(html, /data-company-classification="capital_intensive"/);
  assert.match(html, /投入强度与现金流/);
  assert.match(html, /资本开支/);
  assert.match(html, /规则预设 · 2 图/);
  assert.match(html, /自定义叠加（操作后接管）/);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 1);
});
