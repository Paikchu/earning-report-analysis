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

  assert.match(dashboard, /投资组合/);
  assert.match(dashboard, /<div className="hero">/);
  assert.match(dashboard, /className="portfolio-heading"/);
  assert.match(dashboard, /className="summary-support"/);
  assert.doesNotMatch(dashboard, /MAX \/ PORTFOLIO 01|header-identity/);
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
  assert.match(dashboard, /<header className="portfolio-header"/);
  assert.doesNotMatch(page, /masthead|SnapshotNotice|className="(?:eyebrow|kicker)"/);
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
  assert.match(css, /\.hero \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.summary-nav-value \{[\s\S]*?font-size: clamp\(48px, 5vw, 56px\);/);
  assert.match(css, /\.market-grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(css, /h2 \{[\s\S]*?font: 600 22px\/1\.1 var\(--serif\);/);
  assert.doesNotMatch(css, /\.portfolio-header \{[^}]*background:/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.market-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /font-variant-numeric: tabular-nums lining-nums;/);
  assert.doesNotMatch(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /\.position-scroll \{[\s\S]*?overscroll-behavior: auto;/);
  assert.match(css, /\.table-wrap \{[\s\S]*?overscroll-behavior: auto;/);
});

test("uses an uncolored generic reminder slot beside the ticker", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const mobileCss = css.match(/@media \(max-width: 620px\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";
  const reminderCss = css.match(/\.position-reminder\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(dashboard, /label: "财报（预计）"/);
  assert.doesNotMatch(dashboard, /className="company"/);
  assert.match(dashboard, /function PositionReminder/);
  assert.match(dashboard, /if \(!event\) return null;/);
  assert.match(dashboard, /className="position-identity"[\s\S]*?<PositionReminder/);
  assert.match(dashboard, /className="position-reminder"/);
  assert.doesNotMatch(dashboard, /<i>财报<\/i>|等待日程|data-empty/);
  assert.doesNotMatch(dashboard, /className="position-earnings"/);
  assert.match(css, /\.position-identity\s*\{[^}]*grid-template-columns:\s*4px auto minmax\(0, 1fr\);/s);
  assert.match(reminderCss, /min-width:\s*0;/);
  assert.match(reminderCss, /overflow:\s*hidden;/);
  assert.match(reminderCss, /justify-self:\s*stretch;/);
  assert.doesNotMatch(reminderCss, /background|border|box-shadow|color/);
  assert.match(mobileCss, /\.position-identity \{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: 4px auto minmax\(0, 1fr\);/);
  assert.match(mobileCss, /\.position-reminder \{[^}]*max-width: 210px;[^}]*justify-self: end;/);
});

test("removes the portfolio history chart while keeping supporting metrics", async () => {
  const [response, dashboard, snapshot] = await Promise.all([
    render(),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const html = await response.text();

  assert.match(html, /当前净值/);
  const optionUnrealizedPnl = snapshot.positions
    .filter((position) => position.assetClass === "OPT")
    .reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const netLiquidationWithoutOptionPnl = snapshot.account.netLiquidation - optionUnrealizedPnl;
  assert.match(html, /剔除期权浮盈亏/);
  assert.match(html, new RegExp(`\\$${netLiquidationWithoutOptionPnl.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.replace(".", "\\.")));
  assert.match(html, /净入金/);
  assert.match(html, /现金/);
  assert.doesNotMatch(html, /净值走势|aria-label="净值周期"/);
  assert.doesNotMatch(dashboard, /PortfolioChart|className="portfolio-chart"|range-switch|历史净值正在积累/);
});

test("renders the stock-only investment theme heatmap", async () => {
  const [response, snapshot] = await Promise.all([
    render(),
    readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const html = await response.text();

  assert.match(html, /持仓主题热力图/);
  assert.match(html, /总敞口/);
  assert.match(html, /aria-label="持仓主题热力图"/);
  assert.match(html, /AI \/ 企业软件/);
  assert.match(html, /太空与通信/);
  for (const symbol of ["NVDA", "RKLB"]) {
    const position = snapshot.positions.find((candidate) => candidate.assetClass === "STK" && candidate.symbol === symbol);
    const weight = (position.marketValue / snapshot.account.netLiquidation * 100).toFixed(2).replace(".", "\\.");
    assert.match(html, new RegExp(`${symbol}[^]*?${weight}%`));
  }
});

test("keeps domain headers outside the holding tile area", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.heatmap-domain-tiles \{[^]*?inset: 22px 0 0;/);
  assert.doesNotMatch(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{ display: none; \}/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{[^]*?display: flex;/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-tiles \{ inset: 16px 0 0; \}/);
  assert.match(css, /\.heatmap-domain-narrow \.heatmap-domain-heading \{[^]*?height: 18px;[^]*?writing-mode: horizontal-tb;/);
  assert.match(css, /\.heatmap-domain-narrow \.heatmap-domain-tiles \{ inset: 18px 0 0; \}/);
  assert.match(component, /heatmapDomainDensity/);
  assert.match(component, /insetTreemapRectangle/);
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
  const renderedTickerCount = html.match(/class="position-row position-row-button"/g)?.length ?? 0;

  assert.equal(renderedTickerCount, expectedTickerCount);
  assert.match(html, /aria-label="查看 INTC 持仓详情"/);
  assert.doesNotMatch(html, /href="\/positions\/INTC"/);
  assert.doesNotMatch(html, /<details class="position-row"/);
  assert.match(html, /INTC/);
  assert.match(html, /正股/);
  assert.match(html, /期权/);
  assert.match(html, /净市值/);
  assert.match(html, /年内已实现/);
  assert.match(html, /年内净盈亏/);
  assert.match(html, /财报/);
  assert.match(html, /北京/);
  assert.match(html, /NVDA 正股与期权持仓/);
  assert.match(html, /NVDA Jan15&#x27;27 180 PUT @AMEX/);
  assert.doesNotMatch(html, /持仓拆分|>拆分</);
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
  assert.match(dashboard, /data-active=\{segment\.symbol === activeSymbol/);
  assert.match(dashboard, /data-active=\{activeSymbol === group\.symbol\}/);
  assert.doesNotMatch(dashboard, /data-dimmed/);
  assert.doesNotMatch(heatmap, /data-dimmed/);
  assert.doesNotMatch(css, /\[data-dimmed="true"\]/);
  assert.match(heatmap, /--holding-color/);
  assert.match(heatmap, /signedPercent\(holding\.unrealizedRate\)/);
  assert.doesNotMatch(css, /\.option-pill \{[^]*?color: #8b3b2b;/);
});

test("uses investment theme colors for heatmap headers and holding marks", async () => {
  const [dashboard, heatmap, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /"--holding-color": heatmapThemeColor\(group\.symbol\)/);
  assert.match(heatmap, /"--theme-color": heatmapDomainColor\(group\.domain\)/);
  assert.match(heatmap, /"--holding-color": heatmapThemeColor\(symbol\)/);
  assert.match(css, /\.heatmap-domain-heading\s*\{[^}]*background:\s*color-mix\(in oklch, var\(--theme-color\) 34%, var\(--paper\)\);[^}]*box-shadow:\s*inset 0 4px 0 var\(--theme-color\);/s);
  assert.match(css, /\.heatmap-tile\[data-direction="loss"\]\s*\{[^}]*color-mix\(in oklch,/s);
  assert.match(css, /\.heatmap-tile\[data-direction="gain"\]\s*\{[^}]*color-mix\(in oklch,/s);
  assert.match(css, /\.holding-mark\s*\{[^}]*background:\s*var\(--holding-color\);/s);
});

test("keeps small text high-contrast and visibly weighted", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /--ink-soft:\s*#3f4d5a/);
  assert.match(css, /--color-loss:\s*#9f3528/);
  assert.match(css, /--color-profit:\s*#3f6449/);
  assert.match(css, /body\s*\{[^}]*font-weight:\s*500/s);
  assert.match(css, /-webkit-font-smoothing:\s*auto/);
});

test("enlarges and center-aligns holding row text", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /className="daily-change-value/);
  assert.match(css, /--daily-gain:\s*#315b3d/);
  assert.match(css, /--daily-loss:\s*#8f2f25/);
  assert.match(css, /\.position-row\s*\{[^}]*font-size:\s*11px;[^}]*line-height:\s*1;/s);
  assert.match(css, /\.position-identity\s*\{[^}]*align-items:\s*center;/s);
  assert.match(css, /\.position-reminder\s*\{[^}]*align-content:\s*center;/s);
  assert.match(css, /\.symbol\s*\{[^}]*font:\s*600 14px\/1 var\(--serif\);/s);
  assert.match(css, /\.position-row \.asset-pill\s*\{[^}]*font-size:\s*9px;/s);
  assert.match(css, /\.position-reminder strong\s*\{[^}]*font-size:\s*9px;/s);
  assert.match(css, /\.position-reminder small\s*\{[^}]*font-size:\s*7px;/s);
  assert.match(css, /\.daily-change-value\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*650;/s);
  assert.match(css, /\.position-kinds\s*\{[^}]*justify-content:\s*center;/s);
  assert.match(css, /@media \(max-width: 620px\)[^]*?\.daily-change-value \{ font-size: 12px; \}/);
});

test("keeps full ticker symbols visible before heatmap metrics", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /heatmapTileDensity/);
  assert.match(component, /heatmap-tile-symbol-only/);
  assert.match(css, /\.heatmap-tile-symbol-only \.heatmap-tile-metrics \{ display: none; \}/);
  assert.match(css, /\.heatmap-tile-symbol-only strong\s*\{[^}]*font-size:\s*clamp\(6px,\s*25cqw,\s*9px\);/s);
});

test("renders stock and option submenus directly below mixed holding rows", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const response = await render();
  const html = await response.text();
  const assetClassesBySymbol = new Map();
  for (const position of snapshot.positions) {
    const assetClasses = assetClassesBySymbol.get(position.symbol) ?? new Set();
    assetClasses.add(position.assetClass);
    assetClassesBySymbol.set(position.symbol, assetClasses);
  }
  const expectedSubmenuCount = [...assetClassesBySymbol.values()]
    .filter((assetClasses) => assetClasses.has("STK") && assetClasses.has("OPT"))
    .length;
  const renderedSubmenuCount = html.match(/class="position-submenu"/g)?.length ?? 0;

  assert.match(dashboard, /setSortKey/);
  assert.match(dashboard, /sortDirection/);
  assert.equal(renderedSubmenuCount, expectedSubmenuCount);
  assert.match(dashboard, /group\.stock && group\.options\.length > 0/);
  assert.match(dashboard, /className="position-submenu"/);
  assert.match(dashboard, /className="position-submenu-row"/);
  assert.match(dashboard, /option\.contract/);
  assert.match(dashboard, /option\.marketValue/);
  assert.match(dashboard, /onOpenPosition\(group\)/);
  assert.doesNotMatch(dashboard, /href=\{`\/positions\//);
  assert.doesNotMatch(dashboard, /breakdownSymbol|breakdown-trigger|position-breakdown|持仓拆分/);
  assert.match(css, /\.position-submenu \{[^]*?display: grid;/);
  assert.match(css, /\.position-submenu-row \{[^]*?grid-template-columns:/);
  const mobileCss = css.match(/@media \(max-width: 620px\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";
  assert.match(mobileCss, /\.position-submenu \{[^}]*width: min\(calc\(100% - 8px\), 620px\);[^}]*margin: 0 auto 10px;/);
  assert.match(mobileCss, /\.position-submenu-row \{[^}]*min-height: 34px;[^}]*grid-template-columns: 32px minmax\(0, 1fr\) auto 76px;[^}]*text-align: center;/);
  assert.match(mobileCss, /\.position-submenu-row \.submenu-value \{ text-align: center; \}/);
  assert.doesNotMatch(mobileCss, /\.position-submenu-row \.(?:submenu-type|submenu-quantity|submenu-value) \{[^}]*grid-row:/);
});

test("opens position details in a homepage workspace dialog without navigation", async () => {
  const [dashboard, dialog, addPlanDialog, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/PositionDetailDialog.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../app/AddPlanDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /PositionDetailDialog/);
  assert.match(dashboard, /selectedPosition/);
  assert.doesNotMatch(dashboard, /import Link from "next\/link"/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /\.showModal\(\)/);
  assert.match(dialog, /fetch\(`\/api\/plans\/\$\{encodeURIComponent\(target\.symbol\)\}`/);
  assert.match(dialog, /onPlanDirtyChange/);
  assert.match(dialog, /window\.confirm\("放弃未保存的更改？"\)/);
  assert.match(dialog, /addEventListener\("keydown"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(addPlanDialog, /onSelect/);
  assert.doesNotMatch(addPlanDialog, /href=\{`\/positions\//);
  assert.match(css, /\.position-detail-dialog \{[^]*?width: min\(1180px, calc\(100vw - 48px\)\);[^]*?height: calc\(100dvh - 48px\);/);
  assert.match(css, /\.position-detail-dialog-body \{[^]*?width: min\(1360px, calc\(100% - 48px\)\);/);
  assert.match(css, /\.sec-filings-section,\s*\.plan-editor \{ width: 100%; max-width: none; \}/);
  assert.match(css, /@media \(max-width: 620px\)[^]*?\.position-detail-dialog \{[^]*?width: 100vw;[^]*?height: 100dvh;/);
});

test("renders Yahoo price and daily change surfaces without changing ledger calculations", async () => {
  const [response, detail] = await Promise.all([
    render(),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /股价/);
  assert.match(html, /当日涨跌/);
  assert.match(detail, /Yahoo Finance/);
  assert.match(detail, /行情暂不可用/);
  assert.doesNotMatch(detail, /position\.value\s*=\s*quote|position\.unrealized\s*=\s*quote/);
});

test("renders the large-cap market pulse in the header from the homepage quote batch", async () => {
  const [response, dashboard] = await Promise.all([
    render(),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /美股大盘/);
  assert.match(html, /标普 500/);
  assert.match(html, /纳斯达克/);
  assert.match(html, /道琼斯/);
  assert.match(html, /罗素 2000/);
  assert.match(html, /Yahoo Finance · 页面打开时获取/);
  assert.match(dashboard, /MARKET_INDEX_SYMBOLS/);
  assert.match(dashboard, /const quoteSymbols = useMemo\(\(\) => \[\.\.\.MARKET_INDEX_SYMBOLS/);
  assert.match(dashboard, /useMarketQuotes\(quoteSymbols\)/);
});

test("reuses homepage quotes for holdings and fetches unheld plan tickers separately", async () => {
  const [dashboard, detail] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /quoteStatus=\{selectedPosition\.position \? quoteState\.status : undefined\}/);
  assert.match(detail, /useMarketQuotes\(ticker, quoteStatus === undefined\)/);
});

test("protects the Yahoo quote endpoint with ChatGPT authentication", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("quotes-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/quotes?symbols=MSFT"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "未登录。" });
});

test("exposes authenticated plan reads for the workspace dialog", async () => {
  const route = await readFile(new URL("../app/api/plans/[ticker]/route.ts", import.meta.url), "utf8");

  assert.match(route, /export async function GET/);
  assert.match(route, /getHoldingPlan/);
  assert.match(route, /return Response\.json\(\{ plan \}\)/);
});

test("uses page-scrolling cards for mobile position details", async () => {
  const [detailPage, detailContent, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detailPage, /PositionDetailContent/);
  assert.match(detailContent, /data-label="平均成本"/);
  assert.match(detailContent, /data-label="未实现盈亏"/);
  assert.doesNotMatch(detailContent, /持仓，可横向滚动|持仓明细，可横向滚动/);
  assert.match(css, /\.position-detail\.table-wrap \{\s*overflow: visible;\s*overscroll-behavior: auto;/);
  assert.match(css, /\.instrument-table thead \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.row-arrow \{\s*position: absolute;/);
  assert.match(css, /\.position-identity\s*\{[^}]*grid-column: 1 \/ -1;/);
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
