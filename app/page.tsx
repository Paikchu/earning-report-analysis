"use client";

import { useSyncExternalStore } from "react";
import snapshotData from "@/data/portfolio-snapshot.json";
import { canonicalUnderlying, type PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";

type PageTab = "总览" | "分析";
type LedgerTab = "持仓" | "交易";
type TradeFilter = "全部" | "买入" | "卖出";

const snapshot = snapshotData as PortfolioSnapshotV1;
const snapshotYear = new Date(snapshot.generatedAt).getUTCFullYear();
const realizedBySymbolAndType = snapshot.trades.reduce<Record<string, { stock: number; options: number }>>((totals, trade) => {
  if (new Date(trade.tradeTime).getUTCFullYear() !== snapshotYear) return totals;
  if (trade.securityType !== "STK" && trade.securityType !== "OPT") return totals;
  const symbol = canonicalUnderlying(trade.symbol);
  totals[symbol] ??= { stock: 0, options: 0 };
  if (trade.securityType === "STK") totals[symbol].stock += trade.realizedPnl;
  else totals[symbol].options += trade.realizedPnl;
  return totals;
}, {});
const companyNames = snapshot.trades.reduce<Record<string, string>>((names, trade) => {
  names[trade.symbol] ??= trade.contractDescription;
  return names;
}, {});
const holdings = snapshot.positions
  .filter((position) => position.assetClass === "STK")
  .map((position) => ({
    symbol: position.symbol,
    name: companyNames[position.symbol] ?? position.contractDescription,
    averageCost: position.averagePrice,
    quantity: position.quantity,
    weight: (position.marketValue / snapshot.account.netLiquidation) * 100,
    unrealized: position.unrealizedPnl,
    realized: realizedBySymbolAndType[position.symbol]?.stock ?? 0,
    price: position.marketPrice,
    value: position.marketValue,
    cost: position.costBasis,
  }))
  .sort((left, right) => right.value - left.value);
const optionContracts = snapshot.positions
  .filter((position) => position.assetClass === "OPT")
  .map((position) => ({
    symbol: position.symbol,
    contract: position.contractDescription,
    quantity: position.quantity,
    averageCost: position.averagePrice,
    price: position.marketPrice,
    cost: position.costBasis,
    marketValue: position.marketValue,
    weight: (position.marketValue / snapshot.account.netLiquidation) * 100,
    unrealized: position.unrealizedPnl,
  }));
const positionGroups = [...new Set([...holdings.map((holding) => holding.symbol), ...optionContracts.map((option) => option.symbol)])]
  .map((symbol) => {
    const stock = holdings.find((holding) => holding.symbol === symbol);
    const options = optionContracts.filter((option) => option.symbol === symbol);
    const optionValue = options.reduce((sum, option) => sum + option.marketValue, 0);
    const optionCost = options.reduce((sum, option) => sum + option.cost, 0);
    const optionUnrealized = options.reduce((sum, option) => sum + option.unrealized, 0);
    const value = (stock?.value ?? 0) + optionValue;
    const cost = (stock?.cost ?? 0) + optionCost;
    const unrealized = (stock?.unrealized ?? 0) + optionUnrealized;
    const realizedBreakdown = realizedBySymbolAndType[symbol] ?? { stock: 0, options: 0 };
    const realized = realizedBreakdown.stock + realizedBreakdown.options;

    return {
      symbol,
      name: stock?.name ?? companyNames[symbol] ?? symbol,
      stock,
      options,
      value,
      cost,
      unrealized,
      realized,
      netPnl: unrealized + realized,
      weight: (value / snapshot.account.netLiquidation) * 100,
      grossValue: Math.abs(stock?.value ?? 0) + options.reduce((sum, option) => sum + Math.abs(option.marketValue), 0),
    };
  })
  .sort((left, right) => right.grossValue - left.grossValue);
const recentTrades = snapshot.trades.map((trade) => ({
  id: trade.tradeId,
  time: trade.tradeTime,
  symbol: trade.symbol,
  type: trade.securityType,
  side: trade.side === "BUY" ? "买入" as const : trade.side === "SELL" ? "卖出" as const : trade.side,
  size: trade.size,
  price: trade.price,
  pnl: trade.realizedPnl,
}));
const allocation = positionGroups.filter((group) => group.weight > 0).slice(0, 4).map((group) => [group.symbol, group.weight] as const);
const totalPnl = snapshot.account.netLiquidation - snapshot.account.netDeposits;
const stockMarketValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
const optionMarketValue = optionContracts.reduce((sum, option) => sum + option.marketValue, 0);
const netPositionsValue = stockMarketValue + optionMarketValue;
const topFourWeight = allocation.reduce((sum, [, weight]) => sum + weight, 0);
const topTwoWeight = positionGroups.filter((group) => group.weight > 0).slice(0, 2).reduce((sum, group) => sum + group.weight, 0);
const allocationStops = allocation
  .map(([, weight]) => weight)
  .reduce<number[]>((stops, weight) => [...stops, (stops.at(-1) ?? 0) + weight], []);
const donutBackground = `conic-gradient(var(--ink) 0 ${allocationStops[0] ?? 0}%, #718196 ${allocationStops[0] ?? 0}% ${allocationStops[1] ?? 0}%, var(--vermilion) ${allocationStops[1] ?? 0}% ${allocationStops[2] ?? 0}%, #b47d64 ${allocationStops[2] ?? 0}% ${allocationStops[3] ?? 0}%, var(--paper-deep) ${allocationStops[3] ?? 0}% 100%)`;
const largestLoss = positionGroups.slice().sort((left, right) => left.unrealized - right.unrealized)[0];
const largestRealized = positionGroups.slice().sort((left, right) => right.realized - left.realized)[0];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const utcDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const money = (value: number, sign = false) => {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
};

const formatNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 6) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits }).format(value);

const formatUtc = (value: string) => utcDateTimeFormatter.format(new Date(value));

const actualHoldingCost = (holding: (typeof holdings)[number]) =>
  (holding.cost - holding.realized) / holding.quantity;

function Pnl({ value, currency = true }: { value: number; currency?: boolean }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  const prefix = value < 0 ? "−" : value > 0 ? "+" : "";
  const content = currency ? money(value, true) : `${prefix}${formatNumber(Math.abs(value), 2, 6)}`;
  return <span className={className}>{content}</span>;
}

function updateUrl(page: PageTab, ledger: LedgerTab, tradeFilter: TradeFilter) {
  const url = new URL(window.location.href);
  url.searchParams.set("page", page === "分析" ? "analysis" : "overview");
  if (page === "总览") {
    url.searchParams.set("ledger", ledger === "交易" ? "trades" : "positions");
    if (ledger === "交易" && tradeFilter !== "全部") url.searchParams.set("side", tradeFilter === "买入" ? "buy" : "sell");
    else url.searchParams.delete("side");
  } else {
    url.searchParams.delete("ledger");
    url.searchParams.delete("side");
  }
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new Event("portfolio-navigation"));
}

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("portfolio-navigation", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("portfolio-navigation", onChange);
  };
}

const getLocationSnapshot = () => window.location.search;
const getServerLocationSnapshot = () => "";

export default function Home() {
  const locationSearch = useSyncExternalStore(subscribeToLocation, getLocationSnapshot, getServerLocationSnapshot);
  const locationParams = new URLSearchParams(locationSearch);
  const activePage: PageTab = locationParams.get("page") === "analysis" ? "分析" : "总览";
  const activeLedger: LedgerTab = locationParams.get("ledger") === "trades" ? "交易" : "持仓";
  const tradeFilter: TradeFilter = locationParams.get("side") === "buy" ? "买入" : locationParams.get("side") === "sell" ? "卖出" : "全部";
  const filteredTrades = tradeFilter === "全部" ? recentTrades : recentTrades.filter((trade) => trade.side === tradeFilter);

  const switchPage = (page: PageTab) => {
    updateUrl(page, activeLedger, tradeFilter);
    window.scrollTo({ top: 0 });
  };

  const switchLedger = (ledger: LedgerTab) => {
    updateUrl("总览", ledger, tradeFilter);
  };

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <nav className="tabs" aria-label="投资组合导航">
          {(["总览", "分析"] as PageTab[]).map((tab) => (
            <button
              key={tab}
              className={`tab ${activePage === tab ? "active" : ""}`}
              type="button"
              aria-current={activePage === tab ? "page" : undefined}
              onClick={() => switchPage(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className={`snapshot-status ${snapshot.tradeSync.status === "delayed" ? "snapshot-delayed" : ""}`} role="status" aria-live="polite">
          <span>IBKR 数据更新 {formatUtc(snapshot.generatedAt)} UTC</span>
          {snapshot.tradeSync.status === "delayed" && <strong>交易数据延迟</strong>}
        </div>

        {activePage === "总览" && (
          <>
            <section className="hero" aria-labelledby="portfolio-title">
              <div className="portfolio-heading">
                <h1 id="portfolio-title">投资组合</h1>
                <span>{positionGroups.length} 个 Ticker · {holdings.length} 个正股 · {optionContracts.length} 份期权</span>
              </div>
              <div className="portfolio-summary" aria-label="组合摘要">
                <article className="summary-item summary-nav"><span>当前净值</span><strong>{money(snapshot.account.netLiquidation)}</strong></article>
                <article className="summary-item"><span>净入金</span><strong>{money(snapshot.account.netDeposits)}</strong></article>
                <article className="summary-item"><span>总盈亏</span><strong className={totalPnl < 0 ? "loss" : "gain"}>{money(totalPnl, true)}</strong></article>
                <article className="summary-item"><span>现金</span><strong>{money(snapshot.account.cashBalance)}</strong></article>
              </div>
            </section>

            <section className="lower-grid">
              <aside className="allocation-panel">
                <div className="ruled-heading"><h2>仓位构成</h2></div>
                <div className="allocation-wrap">
                  <div className="donut" style={{ background: donutBackground }} role="img" aria-label={`前四大持仓占组合 ${topFourWeight.toFixed(2)}%`}><span>{topFourWeight.toFixed(1)}%<small>前四大持仓</small></span></div>
                  <div className="legend">
                    {allocation.map(([symbol, weight], index) => (
                      <div className={`legend-row legend-${index + 1}`} key={symbol}>
                        <span><i aria-hidden="true" />{symbol}</span><b>{weight.toFixed(2)}%</b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="concentration-note"><strong>{topTwoWeight.toFixed(2)}%</strong><span>{positionGroups[0]?.symbol} 与 {positionGroups[1]?.symbol} 合计净权重</span></div>
              </aside>

              <section className="ledger-panel" aria-labelledby="ledger-title">
                <div className="ledger-heading">
                  <h2 id="ledger-title">投资账本</h2>
                  <div className="subtabs" role="tablist" aria-label="投资账本内容">
                    {(["持仓", "交易"] as LedgerTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        id={`ledger-tab-${tab}`}
                        aria-selected={activeLedger === tab}
                        aria-controls={`ledger-panel-${tab}`}
                        tabIndex={activeLedger === tab ? 0 : -1}
                        className={activeLedger === tab ? "active" : ""}
                        onClick={() => switchLedger(tab)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          const next = tab === "持仓" ? "交易" : "持仓";
                          switchLedger(next);
                          document.getElementById(`ledger-tab-${next}`)?.focus();
                        }}
                      >
                        {tab}
                        <span>{tab === "持仓" ? positionGroups.length : recentTrades.length}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {activeLedger === "持仓" && (
                  <div className="ledger-content" id="ledger-panel-持仓" role="tabpanel" aria-labelledby="ledger-tab-持仓">
                    <div className="ledger-meta">
                      <span>持仓净市值 <strong>{money(netPositionsValue)}</strong></span>
                      <span>正股 <strong>{money(stockMarketValue)}</strong></span>
                      <span>期权 <strong>{money(optionMarketValue)}</strong></span>
                      <span>{positionGroups.length} 个 Ticker · 点击展开合约</span>
                    </div>
                    <div className="position-scroll" role="region" aria-label="按 Ticker 分类的持仓，可横向滚动" tabIndex={0}>
                      <div className="position-columns" aria-hidden="true">
                        <span>标的</span><span>构成</span><span>净市值</span><span>净权重</span><span>持仓成本</span><span>未实现盈亏</span><span>年内已实现</span><span>年内净盈亏</span><span />
                      </div>
                      <div className="position-list">
                        {positionGroups.map((group) => (
                          <details className="position-row" key={group.symbol}>
                            <summary>
                              <span className="position-identity"><strong className="symbol">{group.symbol}</strong><small className="company">{group.name}</small></span>
                              <span className="position-kinds" data-label="构成">
                                {group.stock && <i className="asset-pill stock-pill">正股</i>}
                                {group.options.length > 0 && <i className="asset-pill option-pill">{group.options.length} 期权</i>}
                              </span>
                              <span data-label="净市值">{money(group.value)}</span>
                              <span data-label="净权重">{formatNumber(group.weight, 2, 2)}%</span>
                              <span data-label="持仓成本">{money(group.cost)}</span>
                              <span data-label="未实现盈亏"><Pnl value={group.unrealized} /></span>
                              <span data-label="年内已实现"><Pnl value={group.realized} /></span>
                              <span data-label="年内净盈亏"><Pnl value={group.netPnl} /></span>
                              <span className="disclosure-mark" aria-hidden="true" />
                            </summary>
                            <div className="position-detail table-wrap" role="region" aria-label={`${group.symbol} 持仓明细，可横向滚动`} tabIndex={0}>
                              <table className="instrument-table" aria-label={`${group.symbol} 正股与期权明细`}>
                                <thead><tr><th>类型</th><th>资产 / 合约</th><th>数量</th><th>现价</th><th>平均成本</th><th>实际成本</th><th>持仓成本</th><th>市值</th><th>权重</th><th>未实现盈亏</th></tr></thead>
                                <tbody>
                                  {group.stock && <tr><td><span className="asset-pill stock-pill">正股</span></td><td><strong>{group.stock.name}</strong></td><td>{formatNumber(group.stock.quantity, 0, 4)}</td><td>{money(group.stock.price)}</td><td>{money(group.stock.averageCost)}</td><td>{money(actualHoldingCost(group.stock))}</td><td>{money(group.stock.cost)}</td><td>{money(group.stock.value)}</td><td>{formatNumber(group.stock.weight, 2, 2)}%</td><td><Pnl value={group.stock.unrealized} /></td></tr>}
                                  {group.options.map((option) => <tr key={option.contract}><td><span className="asset-pill option-pill">期权</span></td><td><strong className="option-contract">{option.contract}</strong></td><td>{formatNumber(option.quantity, 0, 4)}</td><td>{money(option.price)}</td><td>{money(option.averageCost)}</td><td className="muted">—</td><td>{money(option.cost)}</td><td>{money(option.marketValue)}</td><td>{formatNumber(option.weight, 2, 2)}%</td><td><Pnl value={option.unrealized} /></td></tr>)}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        ))}
                        {positionGroups.length === 0 && <p className="empty-state">当前快照没有持仓。</p>}
                      </div>
                    </div>
                    <p className="formula-note">实际持仓成本 =（持仓成本 − 已实现盈亏）÷ 持仓数量</p>
                  </div>
                )}

                {activeLedger === "交易" && (
                  <div className="ledger-content" id="ledger-panel-交易" role="tabpanel" aria-labelledby="ledger-tab-交易">
                    <div className="trade-toolbar">
                      <div className="filter-row" aria-label="交易方向筛选">
                        {(["全部", "买入", "卖出"] as TradeFilter[]).map((filter) => (
                          <button key={filter} type="button" aria-pressed={tradeFilter === filter} className={tradeFilter === filter ? "selected" : ""} onClick={() => updateUrl("总览", "交易", filter)}>{filter}</button>
                        ))}
                      </div>
                      <span>{filteredTrades.length} 笔 · UTC</span>
                    </div>
                    <details className="trade-disclosure" open>
                      <summary><span>交易明细</span><strong>可收起 · 表内滚动</strong><i aria-hidden="true" /></summary>
                      <div className="table-wrap trades-scroll" role="region" aria-label="交易明细，可纵向滚动" tabIndex={0}>
                        <table className="trades-table" aria-label="交易明细">
                          <thead><tr><th>成交时间</th><th>标的</th><th>品种</th><th>方向</th><th>数量</th><th>价格</th><th>已实现盈亏</th></tr></thead>
                          <tbody>{filteredTrades.map((trade) => <tr key={trade.id}><td>{formatUtc(trade.time)}</td><td><strong className="symbol">{trade.symbol}</strong></td><td>{trade.type === "OPT" ? "期权" : trade.type === "STK" ? "正股" : trade.type === "CASH" || trade.type === "FX" ? "换汇" : trade.type}</td><td><span className={`side side-${trade.side}`}>{trade.side}</span></td><td>{formatNumber(trade.size, 0, 6)}</td><td>{money(trade.price)}</td><td><Pnl value={trade.pnl} /></td></tr>)}{filteredTrades.length === 0 && <tr><td className="empty-cell" colSpan={7}>没有符合当前筛选的交易。</td></tr>}</tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}
              </section>
            </section>
          </>
        )}

        {activePage === "分析" && (
          <section className="detail-page analysis-page">
            <div className="detail-intro"><h1>持仓分析</h1></div>
            <div className="analysis-grid">
              <article className="analysis-lead"><span>最大未实现亏损</span><strong>{largestLoss.symbol}</strong><Pnl value={largestLoss.unrealized} /><p>组合权重 {largestLoss.weight.toFixed(2)}%</p></article>
              <article><span>最大已实现收益</span><strong>{largestRealized.symbol}</strong><Pnl value={largestRealized.realized} /><p>当前权重 {largestRealized.weight.toFixed(2)}%</p></article>
              <article><span>{holdings[0]?.symbol} + 现金</span><strong>{money((holdings[0]?.value ?? 0) + snapshot.account.cashBalance)}</strong><p>占 NAV {(((holdings[0]?.value ?? 0) + snapshot.account.cashBalance) / snapshot.account.netLiquidation * 100).toFixed(2)}%</p></article>
            </div>
            <div className="contribution-section">
              <div className="ruled-heading"><h2>未实现盈亏贡献</h2></div>
              <div className="contribution-list">
                {holdings.slice().sort((a, b) => a.unrealized - b.unrealized).slice(0, 8).map((holding) => {
                  const size = Math.max(3, Math.abs(holding.unrealized) / 14.4232);
                  return <div className="contribution-row" key={holding.symbol}><strong>{holding.symbol}</strong><div className="contribution-track"><i className={holding.unrealized < 0 ? "negative" : "positive"} style={{ width: `${Math.min(100, size)}%` }} /></div><Pnl value={holding.unrealized} /></div>;
                })}
              </div>
            </div>
            <div className="analysis-note"><strong>待补充数据</strong><p>每日 NAV · 现金流 · 基准序列</p></div>
          </section>
        )}

        <footer><span>MAX · 投资记录</span><span>数据源：IBKR · 更新于 {formatUtc(snapshot.generatedAt)} UTC</span></footer>
      </main>
    </>
  );
}
