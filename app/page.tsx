"use client";

import { useState } from "react";
import snapshotData from "@/data/portfolio-snapshot.json";
import { realizedPnlByUnderlying, type PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";

type Tab = "总览" | "持仓" | "交易" | "分析";

const snapshot = snapshotData as PortfolioSnapshotV1;
const realizedBySymbol = realizedPnlByUnderlying(snapshot.trades, 2026);
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
  time: trade.tradeTime.slice(0, 16).replace("T", " "),
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
const allocationStops = allocation.map(([, weight]) => weight).reduce<number[]>((stops, weight) => [...stops, (stops.at(-1) ?? 0) + weight], []);
const donutBackground = `conic-gradient(var(--ink) 0 ${allocationStops[0] ?? 0}%, #718196 ${allocationStops[0] ?? 0}% ${allocationStops[1] ?? 0}%, var(--vermilion) ${allocationStops[1] ?? 0}% ${allocationStops[2] ?? 0}%, #b47d64 ${allocationStops[2] ?? 0}% ${allocationStops[3] ?? 0}%, var(--paper-deep) ${allocationStops[3] ?? 0}% 100%)`;
const largestLoss = holdings.slice().sort((left, right) => left.unrealized - right.unrealized)[0];
const largestRealized = holdings.slice().sort((left, right) => right.realized - left.realized)[0];

const money = (value: number, sign = false) => {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 6) =>
  value.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits });

const actualHoldingCost = (holding: (typeof holdings)[number]) =>
  (holding.cost - holding.realized) / holding.quantity;

function Pnl({ value }: { value: number }) {
  return <span className={value < 0 ? "loss" : value > 0 ? "gain" : "muted"}>{money(value, true)}</span>;
}

function PnlNumber({ value, precision = 2 }: { value: number; precision?: number }) {
  const prefix = value < 0 ? "−" : value > 0 ? "+" : "";
  return <span className={value < 0 ? "loss" : value > 0 ? "gain" : "muted"}>{prefix}{formatNumber(Math.abs(value), 2, precision)}</span>;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("总览");
  const [tradeFilter, setTradeFilter] = useState<"全部" | "买入" | "卖出">("全部");
  const filteredTrades = tradeFilter === "全部" ? recentTrades : recentTrades.filter((trade) => trade.side === tradeFilter);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="page-shell">
      <nav className="tabs" aria-label="投资组合导航">
        {(["总览", "持仓", "交易", "分析"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            type="button"
            aria-current={activeTab === tab ? "page" : undefined}
            onClick={() => switchTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className={`snapshot-status ${snapshot.tradeSync.status === "delayed" ? "snapshot-delayed" : ""}`}>
        <span>IBKR 数据更新 {snapshot.generatedAt.slice(0, 16).replace("T", " ")} UTC</span>
        {snapshot.tradeSync.status === "delayed" && <strong>交易数据延迟</strong>}
      </div>

      {activeTab === "总览" && (
        <>
          <section className="hero">
            <h1>投资组合</h1>
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

            <section className="holdings-panel">
              <div className="ruled-heading heading-with-action">
                <h2>核心持仓</h2>
                <button className="text-action" type="button" onClick={() => switchTab("持仓")}>查看全部 {holdings.length} 项</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>标的</th><th>市值</th><th>组合权重</th><th>未实现盈亏</th></tr></thead>
                  <tbody>
                    {holdings.slice(0, 6).map((holding) => (
                      <tr key={holding.symbol}>
                        <td><strong className="symbol">{holding.symbol}</strong><small className="company">{holding.name}</small></td>
                        <td>{money(holding.value)}</td>
                        <td><span className="weight-number">{holding.weight.toFixed(2)}%</span><span className="weight-bar"><i style={{ width: `${Math.min(100, (holding.weight / (holdings[0]?.weight || 1)) * 100)}%` }} /></span></td>
                        <td><Pnl value={holding.unrealized} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="recent-strip">
            <div className="ruled-heading"><h2>最近动作</h2></div>
            <div className="trade-cards">
              {recentTrades.slice(0, 3).map((trade) => (
                <article key={`${trade.time}-${trade.symbol}-${trade.size}`}>
                  <time>{trade.time.slice(5)}</time>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.side} {trade.size} · {money(trade.price)}</span>
                </article>
              ))}
              <button type="button" className="ledger-link" onClick={() => switchTab("交易")}>查看交易账本 <span aria-hidden="true">↗</span></button>
            </div>
          </section>
        </>
      )}

      {activeTab === "持仓" && (
        <section className="detail-page">
          <div className="detail-intro">
            <h1>持仓账本</h1>
          </div>
          <div className="detail-stats"><span><small>正股市值</small><strong>{money(stockMarketValue)}</strong></span><span><small>前两大权重</small><strong>{topTwoWeight.toFixed(2)}%</strong></span><span><small>期权合约</small><strong>{optionContracts.length}</strong></span></div>
          <div className="table-wrap full-table">
            <table className="complete-holdings-table">
              <thead><tr><th>Ticker</th><th>实际持仓成本</th><th>平均持仓成本</th><th>持仓数量</th><th>持仓占比</th><th>未实现盈亏</th><th>已实现盈亏</th><th>当前价格</th><th>持仓市值</th><th>持仓成本</th></tr></thead>
              <tbody>{holdings.map((holding) => <tr key={holding.symbol}><td><strong className="symbol">{holding.symbol}</strong><small className="company">{holding.name}</small></td><td>{formatNumber(actualHoldingCost(holding), 2, 2)}</td><td>{formatNumber(holding.averageCost, 2, 2)}</td><td>{formatNumber(holding.quantity, 0, 4)}</td><td>{formatNumber(holding.weight, 2, 2)}%</td><td><PnlNumber value={holding.unrealized} /></td><td><PnlNumber value={holding.realized} precision={6} /></td><td>{formatNumber(holding.price, 2, 2)}</td><td>{formatNumber(holding.value, 2, 2)}</td><td>{formatNumber(holding.cost, 2, 6)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="formula-note">实际持仓成本 =（持仓成本 − 已实现盈亏）÷ 持仓数量</p>
          <div className="options-block">
            <div className="ruled-heading"><h2>期权覆盖</h2></div>
            <div className="table-wrap full-table">
              <table className="options-table">
                <thead><tr><th>合约</th><th>数量</th><th>持仓成本</th><th>期权市值</th><th>未实现盈亏</th></tr></thead>
                <tbody>{optionContracts.map((option) => <tr key={option.contract}><td><strong className="option-contract">{option.contract}</strong></td><td>{formatNumber(option.quantity)}</td><td>{formatNumber(option.cost, 2, 2)}</td><td>{formatNumber(option.marketValue, 2, 2)}</td><td><PnlNumber value={option.unrealized} /></td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "交易" && (
        <section className="detail-page">
          <div className="detail-intro">
            <h1>交易账本</h1>
          </div>
          <div className="filter-row" aria-label="交易方向筛选">
            {(["全部", "买入", "卖出"] as const).map((filter) => <button key={filter} type="button" className={tradeFilter === filter ? "selected" : ""} onClick={() => setTradeFilter(filter)}>{filter}</button>)}
          </div>
          <div className="table-wrap full-table trades-table">
            <table>
              <thead><tr><th>成交时间</th><th>标的</th><th>品种</th><th>方向</th><th>数量</th><th>价格</th><th>已实现盈亏</th></tr></thead>
              <tbody>{filteredTrades.map((trade, index) => <tr key={`${trade.time}-${trade.symbol}-${index}`}><td>{trade.time}</td><td><strong className="symbol">{trade.symbol}</strong></td><td>{trade.type === "OPT" ? "期权" : trade.type === "STK" ? "正股" : trade.type === "CASH" ? "换汇" : trade.type}</td><td><span className={`side side-${trade.side}`}>{trade.side}</span></td><td>{trade.size}</td><td>{money(trade.price)}</td><td><Pnl value={trade.pnl} /></td></tr>)}</tbody>
            </table>
          </div>
          <p className="data-footnote">2026 年交易 {recentTrades.length} 笔 · 包含换汇流水 · 时间为 UTC</p>
        </section>
      )}

      {activeTab === "分析" && (
        <section className="detail-page analysis-page">
          <div className="detail-intro">
            <h1>持仓分析</h1>
          </div>
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

      <footer><span>MAX · 投资记录</span><span>数据源：IBKR · 数据更新 {snapshot.generatedAt.slice(0, 16).replace("T", " ")} UTC</span></footer>
    </main>
  );
}
