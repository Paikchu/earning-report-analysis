import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the investment record", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MAX · 投资记录<\/title>/i);
  assert.match(html, /投资组合/);
  assert.match(html, new RegExp(`\\$${snapshot.account.netLiquidation.toLocaleString("en-US", { minimumFractionDigits: 2 })}`.replace(".", "\\.")));
  assert.doesNotMatch(html, /IBKR 数据更新|数据源：IBKR|实际持仓成本\s*=|AI 生成|AI 分析|由 AI/i);
  assert.doesNotMatch(html, />交易(?:<|\s)/);
  assert.doesNotMatch(html, /Google Sheets/);
  assert.doesNotMatch(html, /Portfolio \/ 01|NAV RECONCILIATION|CORE POSITIONS|Transactions \/ 398/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("removes the disposable starter preview", async () => {
  const [page, dashboard, layout, packageJson, viewModel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/portfolio-view-model.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /投资组合/);
  assert.doesNotMatch(page, /LedgerTab|TradeFilter|recentTrades|filteredTrades|switchLedger|updateUrl/);
  assert.doesNotMatch(page, /trade-disclosure|trade-toolbar|交易明细|role="tablist"/);
  assert.match(page, /buildPortfolioViewModel/);
  assert.doesNotMatch(page, /portfolio-history\.json/);
  assert.match(page, /PortfolioDashboard/);
  assert.match(dashboard, /activeSymbol/);
  assert.match(dashboard, /sortPositionGroups/);
  assert.doesNotMatch(dashboard, /filterPortfolioHistory|PortfolioHistoryPoint|PortfolioHistoryRange/);
  assert.doesNotMatch(page, /PageTab|activePage|switchPage|持仓分析|className="tabs"/);
  assert.match(viewModel, /actualCost/);
  assert.match(viewModel, /\(position\.costBasis - realized\) \/ position\.quantity/);
  assert.match(page, /portfolio-snapshot\.json/);
  assert.doesNotMatch(page, /const holdings = \[/);
  assert.doesNotMatch(page, /const optionContracts = \[/);
  assert.doesNotMatch(page, /const recentTrades = \[/);
  assert.doesNotMatch(page, /holding\.weight \/ 31\.12/);
  assert.doesNotMatch(page, /<header|masthead|SnapshotNotice|className="(?:eyebrow|kicker)"/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(layout, /个人投资组合与持仓记录/);
  assert.doesNotMatch(layout, /个人持仓、交易与盈亏记录/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
});

test("uses the approved ledger-dominant hierarchy without horizontal scrolling", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /snapshot-status|ruled-heading|subtabs|formula-note|<footer/);
  assert.doesNotMatch(page, /点击展开合约|可收起|表内滚动/);
  assert.doesNotMatch(page, /个 Ticker|个正股|份期权/);
  assert.match(css, /grid-template-columns: minmax\(240px, 28fr\) minmax\(0, 72fr\);/);
  assert.match(css, /\.lower-grid \{[\s\S]*?border-top: 1px solid var\(--ink\);/);
  assert.match(css, /\.section-divider \{[\s\S]*?border-top: 1px dashed var\(--paper-deep\);/);
  assert.doesNotMatch(css, /min-width:\s*900px/);
  assert.match(css, /\.position-scroll \{[\s\S]*?overflow-x: visible;/);
  assert.match(css, /\.portfolio-heading h1 \{[\s\S]*?font-size: 18px;/);
  assert.match(css, /h2 \{[\s\S]*?font: 600 22px\/1\.1 var\(--serif\);/);
  assert.match(css, /\.summary-nav-value \{[\s\S]*?font-size: clamp\(48px, 5vw, 56px\);/);
  assert.match(css, /font-variant-numeric: tabular-nums lining-nums;/);
  assert.doesNotMatch(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /\.position-scroll \{[\s\S]*?overscroll-behavior: auto;/);
  assert.match(css, /\.table-wrap \{[\s\S]*?overscroll-behavior: auto;/);
});

test("removes the portfolio history chart while keeping supporting metrics", async () => {
  const [response, dashboard] = await Promise.all([
    render(),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /当前净值/);
  assert.match(html, /净入金/);
  assert.match(html, /现金/);
  assert.doesNotMatch(html, /净值走势|aria-label="净值周期"/);
  assert.doesNotMatch(dashboard, /PortfolioChart|className="portfolio-chart"|range-switch|历史净值正在积累/);
});

test("renders the stock-only investment theme heatmap", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /持仓主题热力图/);
  assert.match(html, /总敞口/);
  assert.match(html, /aria-label="持仓主题热力图"/);
  assert.match(html, /AI \/ 企业软件/);
  assert.match(html, /太空与通信/);
  assert.match(html, /NVDA[^]*?10\.87%/);
  assert.match(html, /RKLB[^]*?1\.68%/);
});

test("keeps domain headers outside the holding tile area", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.heatmap-domain-tiles \{[^]*?inset: 22px 0 0;/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-tiles \{ inset: 0; \}/);
});

test("uses an in-plot floating window for holding details", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /className="heatmap-popover"/);
  assert.match(component, /role="tooltip"/);
  assert.doesNotMatch(component, /className="heatmap-detail"/);
  assert.match(component, /onMouseEnter=\{cancelPopoverClose\}/);
  assert.match(component, /onMouseLeave=\{schedulePopoverClose\}/);
  assert.match(component, /positionPopover[^]*?\[plotSize, popover\?\.symbol, positionPopover\]/);
  assert.match(css, /\.heatmap-popover \{[^]*?position: absolute;/);
  assert.match(css, /\.heatmap-popover \{[^]*?z-index: 4;/);
  assert.match(css, /\.heatmap-popover \{[^]*?pointer-events: auto;/);
});

test("keeps the heatmap responsive and keyboard reachable", async () => {
  const [dashboard, component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /PortfolioHeatmap/);
  assert.match(css, /\.heatmap-plot \{[^]*?overflow: hidden;/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{ display: none; \}/);
  assert.match(css, /\.heatmap-tile:focus-visible/);
  assert.match(component, /onFocus=/);
  assert.match(component, /onBlur=/);
  assert.match(css, /@media \(max-width: 620px\)[^]*?\.heatmap-domain-tiles \{ inset-block-start: 20px; \}/);
});

test("groups stock and option positions by ticker", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const response = await render();
  const html = await response.text();
  const expectedTickerCount = new Set(snapshot.positions.map((position) => position.symbol)).size;
  const renderedTickerCount = html.match(/class="position-row"/g)?.length ?? 0;

  assert.equal(renderedTickerCount, expectedTickerCount);
  assert.match(html, /href="\/positions\/INTC"/);
  assert.doesNotMatch(html, /<details class="position-row"/);
  assert.match(html, /INTC/);
  assert.match(html, /正股/);
  assert.match(html, /期权/);
  assert.match(html, /净市值/);
  assert.match(html, /年内已实现/);
  assert.match(html, /年内净盈亏/);
  assert.match(html, /持仓拆分/);
  assert.doesNotMatch(html, /期权覆盖/);
});

test("uses semantic color tokens, stable holding marks, and a filled plan button", async () => {
  const [dashboard, heatmap, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /--color-profit:/);
  assert.match(css, /--color-loss:/);
  assert.match(css, /\.add-plan-button[^]*?background: var\(--ink\);/);
  assert.match(dashboard, /holdingColor/);
  assert.match(dashboard, /otherWeight/);
  assert.match(dashboard, /data-dimmed/);
  assert.match(heatmap, /--holding-color/);
  assert.match(heatmap, /signedPercent\(holding\.unrealizedRate\)/);
  assert.doesNotMatch(css, /\.option-pill \{[^]*?color: #8b3b2b;/);
});

test("renders sortable ledger headers and short-option breakdowns", async () => {
  const dashboard = await readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /setSortKey/);
  assert.match(dashboard, /sortDirection/);
  assert.match(dashboard, /position-breakdown/);
  assert.match(dashboard, /持仓拆分/);
  assert.match(dashboard, /option\.marketValue/);
  assert.match(dashboard, /href=\{`\/positions\//);
});

test("uses page-scrolling cards for mobile position details", async () => {
  const [detailPage, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detailPage, /data-label="平均成本"/);
  assert.match(detailPage, /data-label="未实现盈亏"/);
  assert.doesNotMatch(detailPage, /持仓，可横向滚动|持仓明细，可横向滚动/);
  assert.match(css, /\.position-detail\.table-wrap \{\s*overflow: visible;\s*overscroll-behavior: auto;/);
  assert.match(css, /\.instrument-table thead \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.row-arrow \{\s*position: absolute;/);
  assert.match(css, /\.position-identity \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.position-kinds \{ grid-column: 1 \/ -1;/);
});

test("centers the add-plan dialog and hides its scrollbar", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.plan-dialog \{[^]*?position: fixed;[^]*?inset: 50% auto auto 50%;[^]*?transform: translate\(-50%, -50%\);/);
  assert.match(css, /\.dialog-card \{[^]*?overflow-y: auto;[^]*?scrollbar-width: none;/);
  assert.match(css, /\.dialog-card::-webkit-scrollbar \{ display: none; \}/);
});

test("calculates actual holding cost from cost, realized P&L, and quantity", () => {
  const fixtures = [
    { symbol: "BOXX", cost: 21067.4311002, realized: 1.063786, quantity: 180, expected: 117.04 },
    { symbol: "TSLA", cost: 5838.87880005, realized: -44.802037, quantity: 15, expected: 392.25 },
    { symbol: "ORCL", cost: 3903.89579991, realized: 264.609827, quantity: 27, expected: 134.79 },
    { symbol: "RKLB", cost: 1222.83379995, realized: 725.296967, quantity: 15, expected: 33.17 },
  ];

  for (const fixture of fixtures) {
    const actual = (fixture.cost - fixture.realized) / fixture.quantity;
    assert.equal(Number(actual.toFixed(2)), fixture.expected, fixture.symbol);
  }
});
