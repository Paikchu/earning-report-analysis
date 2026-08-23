import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(path = "/", options = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", ...(options.headers ?? {}) } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...(options.env ?? {}) },
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

test("uses one compact header row for the brand and all primary views", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /<header class="site-header"/);
  assert.match(html, /<header class="site-header"[\s\S]*?MAX[\s\S]*?投资记录[\s\S]*?Portfolio[\s\S]*?投资账本[\s\S]*?每日复盘[\s\S]*?今日宏观经济[\s\S]*?昨日收盘总结[\s\S]*?<\/header>/);
  assert.match(html, /href="\/"[^>]*aria-current="page"[^>]*>Portfolio</);
  assert.match(html, /href="\/ledger"[^>]*>投资账本</);
  assert.match(html, /href="\/\?view=review"[^>]*>每日复盘</);
  assert.match(html, /href="\/macro"[^>]*>今日宏观经济</);
  assert.match(html, /href="\/market-close"[^>]*>昨日收盘总结</);
  assert.doesNotMatch(html, /class="dashboard-tabs"/);
  assert.match(html, /id="portfolio-panel"[^>]*role="region"/);
  assert.match(html, /id="review-panel"[^>]*role="region"/);
  assert.doesNotMatch(html, /<header class="site-header"[\s\S]*?当前净值[\s\S]*?<\/header>/);
});

test("opens device-local net deposit settings from the profile menu", async () => {
  const [response, header, dashboard, dialog, css] = await Promise.all([
    render(),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/investment-settings-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /class="profile-menu"/);
  assert.match(html, /aria-label="打开账户菜单"/);
  assert.match(html, />设置</);
  assert.match(html, /class="settings-dialog"/);
  assert.match(html, /当前净入金/);
  assert.match(header, /onOpenSettings/);
  assert.match(dashboard, /localStorage\.getItem\(NET_DEPOSITS_STORAGE_KEY\)/);
  assert.match(dashboard, /localStorage\.setItem\(NET_DEPOSITS_STORAGE_KEY, String\(value\)\)/);
  assert.match(dashboard, /const configuredTotalPnl = netLiquidation - configuredNetDeposits/);
  assert.match(dialog, /type="number"/);
  assert.match(css, /\.profile-menu \{[^}]*margin-left: auto;[^}]*position: relative;/s);
  assert.match(css, /\.settings-dialog \{[^}]*position: fixed;[^}]*width: min\(440px,/s);
});

test("renders the investment ledger as an independent primary page", async () => {
  const [homeResponse, ledgerResponse] = await Promise.all([render(), render("/ledger")]);
  const [homeHtml, ledgerHtml] = await Promise.all([homeResponse.text(), ledgerResponse.text()]);

  assert.equal(ledgerResponse.status, 200);
  assert.doesNotMatch(homeHtml, /id="ledger-title"/);
  assert.match(ledgerHtml, /href="\/ledger"[^>]*aria-current="page"[^>]*>投资账本</);
  assert.match(ledgerHtml, /<h1 id="ledger-title">投资账本<\/h1>/);
  assert.match(ledgerHtml, /aria-label="账本排序"/);
  assert.match(ledgerHtml, /class="position-list"/);
  assert.doesNotMatch(ledgerHtml, /class="portfolio-overview"|class="heatmap-plot"/);
});

test("uses compact editorial density for macro and daily review pages", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.macro-hero \{[\s\S]*?grid-template-areas:\s*"label label" "title summary" "title asof";/);
  assert.match(css, /\.macro-hero h1 \{[\s\S]*?font-size: clamp\(34px, 4vw, 52px\);[\s\S]*?line-height: 1\.04;/);
  assert.match(css, /\.macro-hero > p \{[\s\S]*?font: 500 clamp\(15px, 1\.25vw, 17px\)\/1\.55 var\(--serif\);/);
  assert.match(css, /\.daily-review-heading h2 \{[\s\S]*?font-size: clamp\(22px, 1\.8vw, 28px\);/);
  assert.match(css, /\.daily-review-summary \{[\s\S]*?font: 500 14px\/1\.55 var\(--serif\);/);
  assert.match(css, /\.review-driver-list li \{[\s\S]*?padding: 11px 0 11px 32px;/);
});

test("renders the independent macro dashboard without adding market charts to the homepage", async () => {
  const [homeResponse, macroResponse] = await Promise.all([render(), render("/macro")]);
  const [homeHtml, macroHtml] = await Promise.all([homeResponse.text(), macroResponse.text()]);

  assert.equal(macroResponse.status, 200);
  assert.doesNotMatch(homeHtml, /今日宏观影响|美债期限 ETF|TVC:US10Y/);
  assert.match(macroHtml, /今日宏观影响/);
  assert.match(macroHtml, /美国大盘/);
  assert.match(macroHtml, /美债期限 ETF/);
  assert.match(macroHtml, /未来七天经济事件/);
  assert.match(macroHtml, /href="\/"[^>]*>Portfolio</);
  assert.match(macroHtml, /href="\/\?view=review"[^>]*>每日复盘</);
  assert.match(macroHtml, /href="\/macro"[^>]*aria-current="page"[^>]*>今日宏观经济</);
  for (const symbol of ["AMEX:SPY", "NASDAQ:QQQ", "AMEX:IWM", "NASDAQ:SHY", "NASDAQ:IEF", "NASDAQ:TLT"]) {
    assert.match(macroHtml, new RegExp(symbol.replace(":", "(?:<!-- -->)?:")));
  }
  assert.doesNotMatch(macroHtml, /TVC:US(?:02|10|30)Y/);
});

test("renders the latest close brief as an independent archived document", async () => {
  const [homeResponse, marketCloseResponse] = await Promise.all([render(), render("/market-close")]);
  const [homeHtml, marketCloseHtml] = await Promise.all([homeResponse.text(), marketCloseResponse.text()]);

  assert.equal(marketCloseResponse.status, 200);
  assert.doesNotMatch(homeHtml, /板块全景|长债压力没有退场/);
  assert.match(marketCloseHtml, /href="\/market-close"[^>]*aria-current="page"[^>]*>昨日收盘总结</);
  assert.match(marketCloseHtml, /道指领涨，但长债压力没有退场/);
  assert.match(marketCloseHtml, /主要指数/);
  assert.match(marketCloseHtml, /11 SECTORS/);
  assert.match(marketCloseHtml, /下个交易日关注/);
  assert.match(marketCloseHtml, /本文为公开信息的整理与分析，不构成任何投资建议/);
});

test("rejects anonymous access to accession-specific SEC reports", async () => {
  const response = await render("/positions/MSFT/sec/0000789019-26-000001");

  assert.ok([302, 303, 307, 308].includes(response.status));
  assert.match(response.headers.get("location") ?? "", /signin-with-chatgpt/);
});

test("removes the disposable starter preview", async () => {
  const [page, dashboard, siteHeader, layout, packageJson, viewModel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
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
  assert.match(dashboard, /<SiteHeader active=\{activeView\} onViewChange=\{switchView\} onOpenSettings=/);
  assert.match(siteHeader, /<header className="site-header"/);
  assert.match(dashboard, /<section className="portfolio-overview"/);
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
  assert.match(css, /\.hero \{[\s\S]*?grid-template-columns: minmax\(300px, \.75fr\) minmax\(0, 1\.25fr\);/);
  assert.match(css, /\.summary-nav-value \{[\s\S]*?font-size: clamp\(36px, 4vw, 44px\);/);
  assert.match(css, /\.header-position-summary \{[\s\S]*?grid-template-columns: minmax\(110px, \.65fr\) minmax\(110px, \.65fr\) minmax\(190px, 1fr\) minmax\(280px, 1\.8fr\);/);
  assert.match(css, /h2 \{[\s\S]*?font: 600 22px\/1\.1 var\(--serif\);/);
  assert.doesNotMatch(css, /\.portfolio-header \{[^}]*background:/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.header-position-summary \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
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

test("renders the current portfolio leverage in the portfolio overview", async () => {
  const [response, snapshot] = await Promise.all([
    render(),
    readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const html = await response.text();
  const grossPositionsValue = snapshot.positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const leverage = grossPositionsValue / snapshot.account.netLiquidation;

  assert.match(html, /杠杆率/);
  assert.match(html, new RegExp(`${leverage.toFixed(2)}(?:<!-- -->)?x`));
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
  assert.match(html, /class="heatmap-domain /);
  const representativePositions = snapshot.positions
    .filter((position) => position.assetClass === "STK" && position.marketValue > 0)
    .sort((left, right) => right.marketValue - left.marketValue)
    .slice(0, 2);
  assert.ok(representativePositions.length > 0);
  for (const position of representativePositions) {
    const weight = (position.marketValue / snapshot.account.netLiquidation * 100).toFixed(2).replace(".", "\\.");
    assert.match(html, new RegExp(`${position.symbol}[^]*?${weight}%`));
  }
});

test("renders holding and sector allocation charts together", async () => {
  const [response, dashboard, css] = await Promise.all([
    render(),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /id="holding-allocation-title">个股</);
  assert.match(html, /id="sector-allocation-title">板块</);
  assert.equal(html.match(/class="allocation-ring"/g)?.length, 2);
  assert.doesNotMatch(html, /role="tablist"|role="tab"|role="tabpanel"/);
  assert.doesNotMatch(dashboard, /AllocationMode|allocationModes|setMode|aria-selected/);
  assert.match(dashboard, /SectorAllocationRing/);
  assert.match(dashboard, /allocationColor\(index\)/);
  assert.match(css, /\.allocation-comparison/);
  assert.doesNotMatch(css, /\.allocation-tabs|\.allocation-tabpanels|\.allocation-tabpanel/);
});

test("keeps domain headers outside the holding tile area", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.heatmap-domain-tiles \{[^]*?inset: 26px 0 0;/);
  assert.doesNotMatch(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{ display: none; \}/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-heading \{[^]*?display: flex;/);
  assert.match(css, /\.heatmap-domain-compact \.heatmap-domain-tiles \{ inset: 24px 0 0; \}/);
  assert.match(css, /\.heatmap-domain-narrow \.heatmap-domain-heading \{[^]*?height: 24px;[^]*?writing-mode: horizontal-tb;/);
  assert.match(css, /\.heatmap-domain-narrow \.heatmap-domain-tiles \{ inset: 24px 0 0; \}/);
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
  const response = await render("/ledger");
  const html = await response.text();
  const symbols = [...new Set(snapshot.positions.map((position) => position.symbol))];
  const expectedTickerCount = symbols.length;
  const renderedTickerCount = html.match(/class="position-row"/g)?.length ?? 0;

  assert.equal(renderedTickerCount, expectedTickerCount);
  assert.doesNotMatch(html, /aria-label="查看 [^"]+ 持仓详情"/);
  assert.match(html, /，查看持仓详情/);
  assert.doesNotMatch(html, /<details class="position-row"/);
  for (const symbol of symbols) {
    const href = `href="/positions/${encodeURIComponent(symbol)}"`;
    assert.match(html, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /净市值/);
  assert.match(html, /年内已实现/);
  assert.match(html, /年内净盈亏/);
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
  assert.match(dashboard, /allocationColor/);
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

test("keeps ledger labels and values above the minimum readable sizes", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /className="daily-change-value/);
  assert.match(css, /--daily-gain:\s*#315b3d/);
  assert.match(css, /--daily-loss:\s*#8f2f25/);
  assert.match(css, /--ink-muted:\s*#596572/);
  assert.match(css, /\.position-row\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(css, /\.position-identity\s*\{[^}]*align-items:\s*center;/s);
  assert.match(css, /\.position-reminder\s*\{[^}]*align-content:\s*center;/s);
  assert.match(css, /\.symbol\s*\{[^}]*font:\s*600 15px\/1 var\(--serif\);/s);
  assert.match(css, /\.position-reminder strong\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(css, /\.position-reminder small\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(css, /\.daily-change-value\s*\{[^}]*font-size:\s*14px;/s);
});

test("compresses the desktop ledger into six paired data groups", async () => {
  const dashboard = await readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /const columns = \["标的", "行情", "仓位", "摊薄成本", "未实现", "年内"\]/);
  assert.match(dashboard, /className="position-market-cell"/);
  assert.match(dashboard, /className="position-value-cell"/);
  assert.match(dashboard, /className="position-cost-cell"/);
  assert.match(dashboard, /className="position-cost-cell" data-label="摊薄成本"/);
  assert.match(dashboard, /className="position-year-cell"/);
  assert.match(dashboard, /group\.stock \? money\(group\.stock\.actualCost\)/);
});

test("keeps full ticker symbols visible before heatmap metrics", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/portfolio-heatmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /heatmapTileDensity/);
  assert.match(component, /heatmap-tile-symbol-only/);
  assert.match(css, /\.heatmap-tile-symbol-only \.heatmap-tile-metrics \{ display: none; \}/);
  assert.match(css, /\.heatmap-tile-symbol-only strong\s*\{[^}]*font-size:\s*12px;/s);
});

test("renders option-only submenus below every ticker with options", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const response = await render("/ledger");
  const html = await response.text();
  const optionSymbols = new Set(
    snapshot.positions.filter((position) => position.assetClass === "OPT").map((position) => position.symbol),
  );
  const renderedSubmenuCount = html.match(/class="position-submenu"/g)?.length ?? 0;

  assert.match(dashboard, /setSortKey/);
  assert.match(dashboard, /sortDirection/);
  assert.equal(renderedSubmenuCount, optionSymbols.size);
  assert.match(dashboard, /group\.options\.length > 0/);
  assert.doesNotMatch(dashboard, /group\.stock && group\.options\.length > 0/);
  assert.match(dashboard, /className="position-submenu"/);
  assert.match(dashboard, /className="position-submenu-row"/);
  assert.match(dashboard, /option\.contract/);
  assert.match(dashboard, /option\.marketValue/);
  assert.doesNotMatch(dashboard, /className="submenu-type">正股/);
  assert.doesNotMatch(dashboard, /data-label="构成"|label: "构成"|className="position-kinds"/);
  assert.doesNotMatch(dashboard, /onOpenPosition/);
  assert.match(dashboard, /href=\{`\/positions\/\$\{encodeURIComponent\(group\.symbol\)\}`\}/);
  assert.doesNotMatch(dashboard, /breakdownSymbol|breakdown-trigger|position-breakdown|持仓拆分/);
  assert.match(css, /\.position-submenu \{[^]*?display: grid;/);
  assert.match(css, /\.position-submenu-row \{[^]*?grid-template-columns:/);
  assert.doesNotMatch(css, /\.position-kinds/);
  const mobileCss = css.match(/@media \(max-width: 620px\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";
  assert.match(mobileCss, /\.position-submenu \{[^}]*width: min\(calc\(100% - 8px\), 620px\);[^}]*margin: 0 auto 10px;/);
  assert.match(mobileCss, /\.position-submenu-row \{[^}]*min-height: 44px;[^}]*grid-template-columns: 32px minmax\(0, 1fr\) auto 76px;[^}]*font-size: 12px;[^}]*text-align: center;/);
  assert.match(mobileCss, /\.position-submenu-row \.submenu-value \{ text-align: center; \}/);
  assert.doesNotMatch(mobileCss, /\.position-submenu-row \.(?:submenu-type|submenu-quantity|submenu-value) \{[^}]*grid-row:/);
});

test("uses independent position routes and removes the workspace dialog", async () => {
  const [dashboard, addPlanDialog, detail, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AddPlanDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /import Link from "next\/link"/);
  assert.doesNotMatch(dashboard, /PositionDetailDialog|selectedPosition/);
  assert.doesNotMatch(dashboard, /aria-label=\{`查看 \$\{group\.symbol\} 持仓详情`\}/);
  assert.match(dashboard, /className="sr-only">，查看持仓详情/);
  assert.match(addPlanDialog, /router\.push\(`\/positions\/\$\{encodeURIComponent\(result\.symbol\)\}`\)/);
  assert.match(detail, /className="detail-section-nav"/);
  for (const id of ["position-structure", "plan-editor", "ownership-structure", "sec-filings"]) {
    assert.match(detail, new RegExp(`href="#${id}"`));
  }
  assert.match(css, /\.detail-section-nav \{[^]*?position: sticky;/);
  await assert.rejects(access(new URL("app/PositionDetailDialog.tsx", projectRoot)));
});

test("renders Yahoo price and daily change surfaces without changing ledger calculations", async () => {
  const [response, detail] = await Promise.all([
    render("/ledger"),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /行情/);
  assert.match(detail, /activeQuote\.changePercent/);
  assert.match(detail, /RSI 14/);
  assert.match(detail, /activeQuote\.rsi14/);
  assert.match(detail, /Yahoo Finance/);
  assert.match(detail, /行情暂不可用/);
  assert.doesNotMatch(detail, /position\.value\s*=\s*quote|position\.unrealized\s*=\s*quote/);
});

test("renders the source-backed daily portfolio review on the homepage", async () => {
  const [response, review] = await Promise.all([
    render(),
    readFile(new URL("../data/daily-portfolio-review.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const html = await response.text();

  assert.match(html, /每日投资复盘/);
  assert.match(html, new RegExp(review.headline));
  assert.match(html, /关键驱动/);
  assert.match(html, /观察清单/);
  for (const source of review.sources) assert.match(html, new RegExp(source.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("renders the holding summary in the portfolio overview without the market pulse", async () => {
  const [response, dashboard] = await Promise.all([
    render(),
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  const html = await response.text();

  assert.match(html, /持仓净市值/);
  assert.match(html, /正股/);
  assert.match(html, /期权/);
  assert.match(html, /即将财报/);
  assert.doesNotMatch(html, /class="market-tape"|aria-label="美股大盘"/);
  assert.doesNotMatch(dashboard, /MARKET_INDEXES|MARKET_INDEX_SYMBOLS|market-tape/);
  assert.match(dashboard, /const quoteSymbols = useMemo\(\(\) => positionGroups\.map/);
  assert.match(dashboard, /useMarketQuotes\(quoteSymbols\)/);
});

test("keeps the portfolio overview dense across desktop and tablet widths", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.hero \{[^}]*min-height: 0;[^}]*grid-template-columns: minmax\(300px, \.75fr\) minmax\(0, 1\.25fr\);/s);
  assert.match(css, /\.summary-nav-value \{[^}]*font-size: clamp\(36px, 4vw, 44px\);/s);
  assert.match(css, /\.summary-support \{[^}]*grid-template-columns: repeat\(4, minmax\(110px, 1fr\)\);/s);

  const tabletCss = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(tabletCss, /\.hero \{ grid-template-columns: minmax\(230px, \.8fr\) minmax\(0, 1\.2fr\);/);

  const mobileCss = css.match(/@media \(max-width: 620px\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";
  assert.match(mobileCss, /\.hero \{[^}]*grid-template-columns: 1fr;/s);
});

test("keeps both allocation charts visible in a responsive grid", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /className="allocation-comparison"/);
  assert.match(dashboard, /className="allocation-mode-panel" aria-labelledby="holding-allocation-title"/);
  assert.match(dashboard, /className="allocation-mode-panel" aria-labelledby="sector-allocation-title"/);
  assert.match(css, /\.allocation-comparison \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fit,/s);
  assert.match(css, /\.allocation-mode-panel \{[^}]*min-width: 0;[^}]*display: grid;[^}]*grid-template-rows: auto 1fr;/s);
  assert.match(css, /\.allocation-mode-panel > \.allocation-wrap \{[^}]*height: 100%;[^}]*align-items: flex-start;/s);
});

test("fetches homepage and independent detail quotes without modal state", async () => {
  const [dashboard, detail] = await Promise.all([
    readFile(new URL("../app/portfolio-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(dashboard, /selectedPosition|PositionDetailDialog/);
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

test("exposes authenticated plan reads for the independent detail page", async () => {
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
  assert.match(detailContent, /id="position-structure"/);
  assert.match(detailContent, /data-label="平均成本"/);
  assert.match(detailContent, /data-label="未实现盈亏"/);
  assert.doesNotMatch(detailContent, /持仓，可横向滚动|持仓明细，可横向滚动/);
  assert.match(css, /\.position-detail\.table-wrap \{\s*overflow: visible;\s*overscroll-behavior: auto;/);
  assert.match(css, /\.instrument-table thead \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.position-identity\s*\{[^}]*grid-column: 1 \/ -1;/);
});

test("keeps the add-plan dialog content-sized with useful idle and loading states", async () => {
  const [dialog, css] = await Promise.all([
    readFile(new URL("../app/AddPlanDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.plan-dialog \{[^]*?position: fixed;[^]*?inset: 50% auto auto 50%;[^]*?transform: translate\(-50%, -50%\);/);
  assert.doesNotMatch(dialog, /NEW INVESTMENT PLAN|New investment plan/);
  assert.match(dialog, /className="search-help"/);
  assert.match(dialog, /className="search-skeleton"/);
  assert.match(dialog, /const hasQuery = Boolean\(value\.trim\(\)\);[\s\S]*setResults\(\[\]\);[\s\S]*setLoading\(hasQuery\)/);
  assert.match(dialog, /const open = \(\) => \{[\s\S]*setDirectoryUpdatedAt\(""\);[\s\S]*setLoading\(false\);[\s\S]*showModal\(\)/);
  assert.match(dialog, /没有找到匹配的标的/);
  assert.doesNotMatch(css, /\.search-results \{[^}]*min-height:/s);
});

test("calculates actual holding cost from cost, realized P&L, and quantity", () => {
  const fixtures = [
    { label: "large position", cost: 21067.4311002, realized: 1.063786, quantity: 180, expected: 117.04 },
    { label: "realized loss", cost: 5838.87880005, realized: -44.802037, quantity: 15, expected: 392.25 },
    { label: "realized gain", cost: 3903.89579991, realized: 264.609827, quantity: 27, expected: 134.79 },
    { label: "diluted cost", cost: 1222.83379995, realized: 725.296967, quantity: 15, expected: 33.17 },
  ];

  for (const fixture of fixtures) {
    const actual = (fixture.cost - fixture.realized) / fixture.quantity;
    assert.equal(Number(actual.toFixed(2)), fixture.expected, fixture.label);
  }
});
