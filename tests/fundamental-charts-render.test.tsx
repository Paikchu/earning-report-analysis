import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FundamentalChartsView } from "../app/stocks/[ticker]/FundamentalCharts";
import { formatFundamentalPeriod } from "../lib/fundamental-chart.ts";
import { resolveFundamentalPresentation } from "../lib/fundamental-chart-plan.ts";
import type { FundamentalPageState } from "../lib/fundamental-page-state.ts";
import { makeChartResponse, makeChartSeries } from "./fixtures/fundamental-chart.ts";

const pageState: FundamentalPageState = {
  metricKeys: ["total_revenue", "gross_margin"],
};

const callbacks = {
  onMetricKeysChange: () => undefined,
  onRetry: () => undefined,
};

test("stock fundamentals workbench renders one chart behind a single metric picker", () => {
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
  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 1);
  // The mark comes from each metric, so the page offers no chart-type switch,
  // and the fixed report range is no longer a control either.
  assert.doesNotMatch(html, /role="radiogroup"/);
  assert.doesNotMatch(html, /组合|柱状|折线/);
  assert.doesNotMatch(html, /data-static="true"/);
  assert.doesNotMatch(html, /aria-label="显示季度数"/);
  // The metric list lives behind the picker and is not rendered until opened.
  assert.match(html, /aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(html, /叠加指标 <span>营收、毛利率<\/span>/);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 0);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /已连接/);
  assert.doesNotMatch(html, /Yahoo Finance/);
  // Chart and snapshot are one surface now, so nothing switches between them.
  assert.doesNotMatch(html, /aria-label="表格或图表视图"/);
  assert.match(html, /fundamentals-workbench__split/);
});

test("the newest quarter is picked by default and drawn in the highlight colour", () => {
  const data = makeChartResponse();
  const newest = data.periods.at(-1)!.periodEnd;
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={data}
      pageState={pageState}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  // Nothing has been clicked, so the panel opens on the latest quarter.
  assert.match(html, new RegExp(`id="fundamentals-snapshot-heading"[^>]*>${formatFundamentalPeriod(newest)}<`));
  // Exactly the newest period's marks carry the highlight, and its hit target
  // is the pressed one.
  assert.equal((html.match(/class="fundamental-chart__bar"[^>]*data-selected="true"/g) ?? []).length, 1);
  assert.match(html, /<text[^>]*data-selected="true"/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, new RegExp(`data-period-end="${newest}"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-period-end="${newest}"`));
});

test("the snapshot lists operating and valuation measures for the picked quarter", () => {
  const data = makeChartResponse([
    makeChartSeries("total_revenue"),
    makeChartSeries("gross_margin"),
    makeChartSeries("market_cap", [1e12, 1.1e12, 1.2e12, 1.3e12, 1.4e12, 1.5e12]),
    makeChartSeries("pe_ratio", [30, 32, 35, 33, 31, 28.35]),
    makeChartSeries("ev_to_ebitda", [20, 21, 22, 23, 24, 25.5]),
  ]);
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={data}
      pageState={pageState}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  assert.match(html, /<span>经营<\/span>/);
  assert.match(html, /<span>估值<\/span>/);
  // A multiple is formatted as a bare ratio, never compacted like a currency.
  assert.match(html, /<dd>28.35x<\/dd>/);
  assert.match(html, /<dd>25.5x<\/dd>/);
  assert.match(html, /市盈率/);
  assert.match(html, /EV\/EBITDA/);
});

test("the snapshot tells a meaningless growth rate apart from a missing quarter", () => {
  const data = makeChartResponse([
    makeChartSeries("total_revenue"),
    makeChartSeries("gross_margin"),
    // 2024-06 亏损 -150，2025-06 盈利 120：同比是扭亏为盈，增速没有意义；
    // 环比的基数（50）为正，照常出数字。
    makeChartSeries("net_income", [100e6, -150e6, 200e6, 300e6, 50e6, 120e6]),
    // 最新一期没有经营现金流：这一行才是真正的「没有数据」。
    makeChartSeries("operating_cash_flow", [10e6, 20e6, 30e6, 40e6, 50e6, null]),
  ]);
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={data}
      pageState={pageState}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  const netIncomeRow = /<dt>净利润<\/dt>(.*?)<\/dl>/.exec(html)?.[1] ?? "";
  assert.match(netIncomeRow, /<dd>\+140%<\/dd>/);
  // 扭亏为盈标 NM，并且缩写自带展开说明，不再和缺数据同形。
  assert.match(netIncomeRow, /<dd data-delta="muted"><abbr title="[^"]*增速没有数学意义">NM<\/abbr><\/dd>/);

  const cashFlowRow = /<dt>经营现金流<\/dt>(.*?)<\/dl>/.exec(html)?.[1] ?? "";
  assert.match(cashFlowRow, /<dd>暂无数据<\/dd>/);
  assert.match(cashFlowRow, /<dd data-delta="muted">—<\/dd>/);
  assert.doesNotMatch(cashFlowRow, /NM/);
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

  const pendingErrorHtml = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={{ ...makeChartResponse(), status: "pending", fetchedAt: null, periods: [], series: [] }}
      pageState={pageState}
      requestState="error"
      error="基本面同步未能及时完成，请稍后重试。"
      {...callbacks}
    />,
  );
  assert.match(pendingErrorHtml, /基本面同步未完成/);
  assert.match(pendingErrorHtml, /基本面同步未能及时完成/);
  assert.match(pendingErrorHtml, /重新获取/);

  const pendingHtml = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={{ ...makeChartResponse(), status: "pending", fetchedAt: null, periods: [], series: [] }}
      pageState={pageState}
      requestState="refreshing"
      error={null}
      {...callbacks}
    />,
  );
  assert.match(pendingHtml, /同步中/);
  assert.doesNotMatch(pendingHtml, /已连接/);
});

test("each metric draws with the mark its catalog entry declares", () => {
  const html = renderToStaticMarkup(
    <FundamentalChartsView
      ticker="ACME"
      companyName="ACME Industrial"
      data={makeChartResponse()}
      pageState={{ ...pageState, metricKeys: ["gross_margin"] }}
      requestState="ready"
      error={null}
      {...callbacks}
    />,
  );

  // A ratio is a line and never a bar, whichever metrics sit beside it.
  assert.match(html, /class="fundamental-chart__line"/);
  assert.doesNotMatch(html, /class="fundamental-chart__bar"/);
});

test("capital-intensive preset keeps capex on the single core chart without changing user controls", () => {
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

  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 1);
  assert.match(html, /data-presentation-source="preset"/);
  assert.match(html, /data-company-classification="capital_intensive"/);
  assert.match(html, /资本开支/);
  // A preset still resolves to one chart; the picker stays closed either way.
  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 1);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 0);
});
