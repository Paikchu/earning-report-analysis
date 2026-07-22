"use client";

import { useSyncExternalStore } from "react";
import snapshotData from "@/data/portfolio-snapshot.json";
import { realizedPnlByUnderlying, type PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";

type PageTab = "总览" | "分析";
type LedgerTab = "持仓" | "交易";
type TradeFilter = "全部" | "买入" | "卖出";

const snapshot = snapshotData as PortfolioSnapshotV1;
const snapshotYear = new Date(snapshot.generatedAt).getUTCFullYear();
const realizedBySymbol = realizedPnlByUnderlying(snapshot.trades, snapshotYear);
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
    realized: realizedBySymbol[position.symbol] ?? 0,
    price: position.marketPrice,
    value: position.marketValue,
    cost: position.costBasis,
  }))
  .sort((left, right) => right.value - left.value);
const optionContracts = snapshot.positions
  .filter((position) => position.assetClass === "OPT")
  .map((position) => ({
    contract: position.contractDescription,
    quantity: position.quantity,
    cost: position.costBasis,
    marketValue: position.marketValue,
    unrealized: position.unrealizedPnl,
  }));
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
const allocation = holdings.slice(0, 4).map((holding) => [holding.symbol, holding.weight] as const);
const totalPnl = snapshot.account.netLiquidation - snapshot.account.netDeposits;
const stockMarketValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
const topFourWeight = allocation.reduce((sum, [, weight]) => sum + weight, 0);
const topTwoWeight = holdings.slice(0, 2).reduce((sum, holding) => sum + holding.weight, 0);
const allocationStops = allocation
  .map(([, weight]) => weight)
  .reduce<number[]>((stops, weight) => [...stops, (stops.at(-1) ?? 0) + weight], []);
const donutBackground = `conic-gradient(var(--ink) 0 ${allocationStops[0] ?? 0}%, #718196 ${allocationStops[0] ?? 0}% ${allocationStops[1] ?? 0}%, var(--vermilion) ${allocationStops[1] ?? 0}% ${allocationStops[2] ?? 0}%, #b47d64 ${allocationStops[2] ?? 0}% ${allocationStops[3] ?? 0}%, var(--paper-deep) ${allocationStops[3] ?? 0}% 100%)`;
const largestLoss = holdings.slice().sort((left, right) => left.unrealized - right.unrealized)[0];
const largestRealized = holdings.slice().sort((left, right) => right.realized - left.realized)[0];

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
                <span>{holdings.length} 个正股 · {optionContracts.length} 份期权</span>
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
                <div className="concentration-note"><strong>{topTwoWeight.toFixed(2)}%</strong><span>{holdings[0]?.symbol} 与 {holdings[1]?.symbol} 合计权重</span></div>
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
                        <span>{tab === "持仓" ? holdings.length + optionContracts.length : recentTrades.length}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {activeLedger === "持仓" && (
                  <div className="ledger-content" id="ledger-panel-持仓" role="tabpanel" aria-labelledby="ledger-tab-持仓">
                    <div className="ledger-meta">
                      <span>正股市值 <strong>{money(stockMarketValue)}</strong></span>
                      <span>前两大权重 <strong>{topTwoWeight.toFixed(2)}%</strong></span>
                      <span>点击标的展开成本明细</span>
                    </div>
                    <div className="position-columns" aria-hidden="true">
                      <span>标的</span><span>数量</span><span>现价</span><span>市值</span><span>权重</span><span>未实现盈亏</span><span />
                    </div>
                    <div className="position-list">
                      {holdings.map((holding) => (
                        <details className="position-row" key={holding.symbol}>
                          <summary>
                            <span className="position-identity"><strong className="symbol">{holding.symbol}</strong><small className="company">{holding.name}</small></span>
                            <span data-label="数量">{formatNumber(holding.quantity, 0, 4)}</span>
                            <span data-label="现价">{money(holding.price)}</span>
                            <span data-label="市值">{money(holding.value)}</span>
                            <span data-label="权重">{formatNumber(holding.weight, 2, 2)}%</span>
                            <span data-label="未实现盈亏"><Pnl value={holding.unrealized} /></span>
                            <span className="disclosure-mark" aria-hidden="true" />
                          </summary>
                          <div className="position-detail">
                            <span><small>实际持仓成本</small><strong>{money(actualHoldingCost(holding))}</strong></span>
                            <span><small>平均持仓成本</small><strong>{money(holding.averageCost)}</strong></span>
                            <span><small>持仓成本</small><strong>{money(holding.cost)}</strong></span>
                            <span><small>已实现盈亏</small><strong><Pnl value={holding.realized} currency={false} /></strong></span>
                          </div>
                        </details>
                      ))}
                      {holdings.length === 0 && <p className="empty-state">当前快照没有正股持仓。</p>}
                    </div>
                    <p className="formula-note">实际持仓成本 =（持仓成本 − 已实现盈亏）÷ 持仓数量</p>
                    <details className="options-disclosure">
                      <summary><span>期权覆盖</span><strong>{optionContracts.length} 份合约</strong><i aria-hidden="true" /></summary>
                      <div className="table-wrap" role="region" aria-label="期权持仓，可横向滚动" tabIndex={0}>
                        <table className="options-table" aria-label="期权持仓">
                          <thead><tr><th>合约</th><th>数量</th><th>持仓成本</th><th>期权市值</th><th>未实现盈亏</th></tr></thead>
                          <tbody>{optionContracts.map((option) => <tr key={option.contract}><td><strong className="option-contract">{option.contract}</strong></td><td>{formatNumber(option.quantity)}</td><td>{money(option.cost)}</td><td>{money(option.marketValue)}</td><td><Pnl value={option.unrealized} /></td></tr>)}{optionContracts.length === 0 && <tr><td className="empty-cell" colSpan={5}>当前快照没有期权持仓。</td></tr>}</tbody>
                        </table>
                      </div>
                    </details>
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
