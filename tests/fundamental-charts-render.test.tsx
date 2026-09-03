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
  assert.equal((html.match(/data-chart-role="fundamental-chart"/g) ?? []).length, 1);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 1);
  // The mark comes from each metric, so the page offers no chart-type switch.
  assert.doesNotMatch(html, /role="radiogroup"/);
  assert.doesNotMatch(html, /组合|柱状|折线/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /指标 <span>2<\/span>/);
  assert.doesNotMatch(html, /已连接/);
  assert.doesNotMatch(html, /Yahoo Finance/);
  assert.doesNotMatch(html, /role="dialog"/);
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

test("the report range is stated rather than offered as a setting", () => {
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

  // Yahoo publishes five quarters, so the range is a fact about the data rather
  // than a choice; a picker here would only ever redraw the same chart.
  assert.doesNotMatch(html, /aria-label="显示季度数"/);
  assert.match(html, /data-static="true"/);
  assert.match(html, /5 季度/);
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
  assert.match(html, /增长、盈利质量与资本开支/);
  assert.match(html, /资本开支/);
  assert.match(html, /自定义叠加（操作后接管）/);
  assert.equal((html.match(/data-chart-role="metric-selector"/g) ?? []).length, 1);
});
