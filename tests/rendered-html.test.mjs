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
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /投资组合/);
  assert.doesNotMatch(page, /LedgerTab|TradeFilter|recentTrades|filteredTrades|switchLedger|updateUrl/);
  assert.doesNotMatch(page, /trade-disclosure|trade-toolbar|交易明细|role="tablist"/);
  assert.match(page, /snapshot\.trades\.reduce/);
  assert.match(page, /realizedBySymbolAndType/);
  assert.match(page, /companyNames/);
  assert.doesNotMatch(page, /PageTab|activePage|switchPage|持仓分析|className="tabs"/);
  assert.match(page, /actualHoldingCost/);
  assert.match(page, /平均成本/);
  assert.match(page, /\(holding\.cost - holding\.realized\) \/ holding\.quantity/);
  assert.match(page, /className="position-row"/);
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
  assert.equal(page.match(/className="section-divider"/g)?.length, 2);
  assert.match(css, /grid-template-columns: minmax\(240px, 28fr\) minmax\(0, 72fr\);/);
  assert.match(css, /\.lower-grid \{[\s\S]*?border-top: 1px solid var\(--ink\);/);
  assert.match(css, /\.section-divider \{[\s\S]*?border-top: 1px dashed var\(--paper-deep\);/);
  assert.doesNotMatch(css, /min-width:\s*900px/);
  assert.match(css, /\.position-scroll \{[\s\S]*?overflow-x: visible;/);
  assert.match(css, /h1 \{[\s\S]*?font: 600 clamp\(36px, 3\.2vw, 44px\)\/.9 var\(--serif\);/);
  assert.match(css, /h2 \{[\s\S]*?font: 600 22px\/1\.1 var\(--serif\);/);
  assert.match(css, /\.summary-nav strong \{[\s\S]*?font-size: clamp\(26px, 2vw, 30px\);[\s\S]*?font-weight: 600;/);
  assert.doesNotMatch(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /\.position-scroll \{[\s\S]*?overscroll-behavior: auto;/);
  assert.match(css, /\.table-wrap \{[\s\S]*?overscroll-behavior: auto;/);
});

test("keeps the compact portfolio summary without the reconciliation chart", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /className="portfolio-summary"/);
  assert.doesNotMatch(page, /净值对照|capital-chart|capital-landing|analysis-page|<svg/);
});

test("renders the stock-only investment theme heatmap", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /持仓主题热力图/);
  assert.match(html, /含期权负债，正股权重可超过 100%/);
  assert.match(html, /aria-label="持仓主题热力图"/);
  assert.match(html, /AI \/ 企业软件/);
  assert.match(html, /太空与通信/);
  assert.match(html, /NVDA[^]*?10\.87%/);
  assert.match(html, /RKLB[^]*?1\.68%/);
});

test("keeps the heatmap responsive and keyboard reachable", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PortfolioHeatmap/);
  assert.match(css, /\.heatmap-plot \{[^]*?overflow: hidden;/);
  assert.match(css, /\.heatmap-domain-tiles \{[^]*?inset: 0;/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{ display: none; \}/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-tile strong \{[^]*?transform: rotate\(90deg\);/);
  assert.match(css, /\.heatmap-tile:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[^]*?\.heatmap-plot/);
});

test("groups stock and option positions by ticker", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const response = await render();
  const html = await response.text();
  const expectedTickerCount = new Set(snapshot.positions.map((position) => position.symbol)).size;
  const renderedTickerCount = html.match(/class="position-row"/g)?.length ?? 0;

  assert.equal(renderedTickerCount, expectedTickerCount);
  assert.match(html, /INTC/);
  assert.match(html, /正股/);
  assert.match(html, /期权/);
  assert.match(html, /净市值/);
  assert.match(html, /年内已实现/);
  assert.match(html, /年内净盈亏/);
  assert.doesNotMatch(html, /期权覆盖/);
});

test("uses page-scrolling cards for mobile position details", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /data-label="平均成本"/);
  assert.match(page, /data-label="未实现盈亏"/);
  assert.doesNotMatch(page, /持仓，可横向滚动|持仓明细，可横向滚动/);
  assert.match(css, /\.position-detail\.table-wrap \{\s*overflow: visible;\s*overscroll-behavior: auto;/);
  assert.match(css, /\.instrument-table thead \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.disclosure-mark \{\s*position: absolute;/);
  assert.match(css, /\.position-identity \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.position-kinds \{ grid-column: 1 \/ -1;/);
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
