"use client";

import { useState } from "react";

type Tab = "总览" | "持仓" | "交易" | "分析";

const holdings = [
  { symbol: "BOXX", name: "Alpha Architect 1–3 Month Box ETF", weight: 31.12, quantity: 180, price: 117.49, value: 21148.2, cost: 21067.43, unrealized: 80.77, realized: 1.06 },
  { symbol: "MSFT", name: "Microsoft", weight: 23.21, quantity: 40.0455, price: 393.82, value: 15770.72, cost: 17213.04, unrealized: -1442.32, realized: 0 },
  { symbol: "NVDA", name: "NVIDIA", weight: 10.45, quantity: 35.0179, price: 202.81, value: 7101.98, cost: 7131.11, unrealized: -29.13, realized: 0.2 },
  { symbol: "TSLA", name: "Tesla", weight: 8.41, quantity: 15, price: 380.84, value: 5712.6, cost: 5838.88, unrealized: -126.28, realized: -44.8 },
  { symbol: "DRAM", name: "L&G Cyber Security UCITS ETF", weight: 5.43, quantity: 70, price: 52.72, value: 3690.4, cost: 4423.17, unrealized: -732.77, realized: 0 },
  { symbol: "ORCL", name: "Oracle", weight: 5.02, quantity: 27, price: 126.41, value: 3413.07, cost: 3903.9, unrealized: -490.83, realized: 264.61 },
  { symbol: "AVGO", name: "Broadcom", weight: 3.82, quantity: 7.0061, price: 370.83, value: 2598.07, cost: 2691.16, unrealized: -93.09, realized: 42.61 },
  { symbol: "NOW", name: "ServiceNow", weight: 3.04, quantity: 20, price: 103.24, value: 2064.8, cost: 2153.98, unrealized: -89.18, realized: 0 },
  { symbol: "NOK", name: "Nokia", weight: 2.98, quantity: 200, price: 10.12, value: 2024, cost: 2940.22, unrealized: -916.22, realized: 102.29 },
  { symbol: "RKLB", name: "Rocket Lab", weight: 1.49, quantity: 15, price: 67.62, value: 1014.3, cost: 1222.83, unrealized: -208.53, realized: 725.3 },
  { symbol: "MRVL", name: "Marvell Technology", weight: 1.39, quantity: 5, price: 188.68, value: 943.4, cost: 1338.35, unrealized: -394.95, realized: 0 },
  { symbol: "MSTR", name: "Strategy", weight: 0.98, quantity: 7, price: 94.85, value: 663.95, cost: 965.44, unrealized: -301.49, realized: 0 },
  { symbol: "SPCX", name: "Space Innovation ETF", weight: 0.91, quantity: 5, price: 123.99, value: 619.95, cost: 743.6, unrealized: -123.65, realized: 44.83 },
];

const optionContracts = [
  "INTC Nov 20 ’26 70 Put",
  "NOK Jul 24 ’26 16 Call",
  "NOK Jul 31 ’26 16 Call",
  "NVDA Jan 15 ’27 180 Put",
  "RKLB Oct 16 ’26 70 Put",
];

const recentTrades = [
  { time: "2026-07-15 16:39", symbol: "MSTR", type: "STK", side: "买入", size: 1, price: 97.37, pnl: 0 },
  { time: "2026-07-14 17:12", symbol: "ORCL", type: "STK", side: "买入", size: 3, price: 129.665, pnl: 0 },
  { time: "2026-07-14 17:12", symbol: "ORCL", type: "STK", side: "买入", size: 2, price: 129.665, pnl: 0 },
  { time: "2026-07-13 16:31", symbol: "NOK", type: "OPT", side: "买入", size: 1, price: 0.07, pnl: 18.38 },
  { time: "2026-07-13 16:30", symbol: "NOK", type: "OPT", side: "买入", size: 1, price: 0.12, pnl: 83.91 },
  { time: "2026-07-09 16:19", symbol: "RKLB", type: "OPT", side: "卖出", size: 1, price: 8.65, pnl: 0 },
  { time: "2026-07-09 14:43", symbol: "MSTR", type: "STK", side: "买入", size: 1, price: 95.08, pnl: 0 },
  { time: "2026-07-09 10:20", symbol: "ORCL", type: "STK", side: "买入", size: 5, price: 142.38, pnl: 0 },
  { time: "2026-07-09 10:20", symbol: "DRAM", type: "STK", side: "买入", size: 5, price: 62.78, pnl: 0 },
  { time: "2026-07-08 17:10", symbol: "INTC", type: "OPT", side: "卖出", size: 1, price: 5.5, pnl: 0 },
];

const allocation = [
  ["BOXX", 31.12],
  ["MSFT", 23.21],
  ["NVDA", 10.45],
  ["TSLA", 8.41],
] as const;

const money = (value: number, sign = false) => {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function Pnl({ value }: { value: number }) {
  return <span className={value < 0 ? "loss" : value > 0 ? "gain" : "muted"}>{money(value, true)}</span>;
}

function SnapshotNotice() {
  return (
    <div className="snapshot-notice" role="status">
      <span className="status-dot" aria-hidden="true" />
      <span><strong>IBKR 需要重新连接</strong><small>当前展示 Google Sheets 快照</small></span>
    </div>
  );
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
      <header className="masthead">
        <button className="wordmark" type="button" onClick={() => switchTab("总览")}>MAX · 投资记录</button>
        <span className="as-of">2026 年 7 月 20 日 · Google Sheets 快照</span>
        <SnapshotNotice />
      </header>

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

      {activeTab === "总览" && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">Portfolio / 01</p>
              <h1>投资组合</h1>
              <div className="nav-label">当前净值 NAV</div>
              <div className="nav-value">$67,119.06</div>
              <p className="hero-note">更新日期 2026-07-20 · 基准货币 USD</p>
            </div>

            <div className="capital-landing">
              <div className="section-head">
                <div>
                  <p className="kicker">NAV RECONCILIATION</p>
                  <h2>净值对照</h2>
                </div>
                <span className="delta loss">−6.21%</span>
              </div>
              <div className="capital-chart" role="img" aria-label="净入金 71,563.39 美元，当前净值 67,119.06 美元，相差负 4,444.33 美元">
                <div className="capital-guide guide-one" />
                <div className="capital-guide guide-two" />
                <svg viewBox="0 0 760 260" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="capitalFade" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#17283b" stopOpacity=".16" />
                      <stop offset="1" stopColor="#17283b" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="capital-area" d="M24 70 C190 74 260 84 375 112 C515 146 630 158 736 184 L736 236 L24 236 Z" />
                  <path className="capital-line" d="M24 70 C190 74 260 84 375 112 C515 146 630 158 736 184" />
                  <circle className="start-mark" cx="24" cy="70" r="5" />
                  <circle className="end-mark" cx="736" cy="184" r="7" />
                </svg>
                <span className="chart-label chart-start"><small>净入金</small>$71,563</span>
                <span className="chart-label chart-end"><small>当前 NAV</small>$67,119</span>
              </div>
              <p className="chart-caption">口径：当前 NAV − 净入金</p>
            </div>
          </section>

          <section className="metrics" aria-label="组合摘要">
            <article className="metric"><span>净入金</span><strong>$71,563.39</strong><small>手动维护基准</small></article>
            <article className="metric metric-loss"><span>总盈亏</span><strong>−$4,444.33</strong><small>NAV − 净入金</small></article>
            <article className="metric"><span>现金</span><strong>$1,291.46</strong><small>非实时快照</small></article>
          </section>

          <section className="lower-grid">
            <aside className="allocation-panel">
              <div className="ruled-heading"><p className="kicker">CONCENTRATION</p><h2>仓位构成</h2></div>
              <div className="allocation-wrap">
                <div className="donut" role="img" aria-label="前四大持仓占组合 73.19%"><span>73.2%<small>前四大持仓</small></span></div>
                <div className="legend">
                  {allocation.map(([symbol, weight], index) => (
                    <div className={`legend-row legend-${index + 1}`} key={symbol}>
                      <span><i aria-hidden="true" />{symbol}</span><b>{weight.toFixed(2)}%</b>
                    </div>
                  ))}
                </div>
              </div>
              <div className="concentration-note"><strong>54.33%</strong><span>BOXX 与 MSFT 合计权重</span></div>
            </aside>

            <section className="holdings-panel">
              <div className="ruled-heading heading-with-action">
                <div><p className="kicker">CORE POSITIONS</p><h2>核心持仓</h2></div>
                <button className="text-action" type="button" onClick={() => switchTab("持仓")}>查看全部 13 项</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>标的</th><th>市值</th><th>组合权重</th><th>未实现盈亏</th></tr></thead>
                  <tbody>
                    {holdings.slice(0, 6).map((holding) => (
                      <tr key={holding.symbol}>
                        <td><strong className="symbol">{holding.symbol}</strong><small className="company">{holding.name}</small></td>
                        <td>{money(holding.value)}</td>
                        <td><span className="weight-number">{holding.weight.toFixed(2)}%</span><span className="weight-bar"><i style={{ width: `${(holding.weight / 31.12) * 100}%` }} /></span></td>
                        <td><Pnl value={holding.unrealized} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="recent-strip">
            <div className="ruled-heading"><p className="kicker">LEDGER</p><h2>最近动作</h2></div>
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
            <p className="eyebrow">Positions / 13</p>
            <h1>持仓账本</h1>
            <p>数据日期 2026-07-20 · 正股按市值排序</p>
          </div>
          <div className="detail-stats"><span><small>正股市值</small><strong>$66,765.44</strong></span><span><small>前两大权重</small><strong>54.33%</strong></span><span><small>期权合约</small><strong>5</strong></span></div>
          <div className="table-wrap full-table">
            <table>
              <thead><tr><th>标的</th><th>数量</th><th>现价</th><th>市值</th><th>成本</th><th>权重</th><th>未实现</th><th>已实现</th></tr></thead>
              <tbody>{holdings.map((holding) => <tr key={holding.symbol}><td><strong className="symbol">{holding.symbol}</strong><small className="company">{holding.name}</small></td><td>{holding.quantity}</td><td>{money(holding.price)}</td><td>{money(holding.value)}</td><td>{money(holding.cost)}</td><td>{holding.weight.toFixed(2)}%</td><td><Pnl value={holding.unrealized} /></td><td><Pnl value={holding.realized} /></td></tr>)}</tbody>
            </table>
          </div>
          <div className="options-block">
            <div className="ruled-heading"><p className="kicker">OPTIONS</p><h2>期权覆盖</h2></div>
            <p>仅显示表格中可确认的合约名称与方向。</p>
            <div className="contract-list">{optionContracts.map((contract) => <span key={contract}>{contract}<b>空头 1</b></span>)}</div>
          </div>
        </section>
      )}

      {activeTab === "交易" && (
        <section className="detail-page">
          <div className="detail-intro">
            <p className="eyebrow">Transactions / 398</p>
            <h1>交易账本</h1>
            <p>最近成交优先 · 不含换汇流水</p>
          </div>
          <div className="filter-row" aria-label="交易方向筛选">
            {(["全部", "买入", "卖出"] as const).map((filter) => <button key={filter} type="button" className={tradeFilter === filter ? "selected" : ""} onClick={() => setTradeFilter(filter)}>{filter}</button>)}
          </div>
          <div className="table-wrap full-table trades-table">
            <table>
              <thead><tr><th>成交时间</th><th>标的</th><th>品种</th><th>方向</th><th>数量</th><th>价格</th><th>已实现盈亏</th></tr></thead>
              <tbody>{filteredTrades.map((trade, index) => <tr key={`${trade.time}-${trade.symbol}-${index}`}><td>{trade.time}</td><td><strong className="symbol">{trade.symbol}</strong></td><td>{trade.type === "OPT" ? "期权" : "正股"}</td><td><span className={`side side-${trade.side}`}>{trade.side}</span></td><td>{trade.size}</td><td>{money(trade.price)}</td><td><Pnl value={trade.pnl} /></td></tr>)}</tbody>
            </table>
          </div>
          <p className="data-footnote">显示最近 10 笔投资交易 · 源表共 398 行，包含换汇流水</p>
        </section>
      )}

      {activeTab === "分析" && (
        <section className="detail-page analysis-page">
          <div className="detail-intro">
            <p className="eyebrow">Analysis / Snapshot</p>
            <h1>持仓分析</h1>
            <p>数据范围：当前持仓快照</p>
          </div>
          <div className="analysis-grid">
            <article className="analysis-lead"><span>最大未实现亏损</span><strong>MSFT</strong><Pnl value={-1442.32} /><p>组合权重 23.21%</p></article>
            <article><span>最大已实现收益</span><strong>RKLB</strong><Pnl value={725.3} /><p>当前权重 1.49%</p></article>
            <article><span>BOXX + 现金</span><strong>$22,439.66</strong><p>占 NAV 33.43%</p></article>
          </div>
          <div className="contribution-section">
            <div className="ruled-heading"><p className="kicker">UNREALIZED P&L</p><h2>未实现盈亏贡献</h2></div>
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

      <footer><span>MAX · 投资记录</span><span>数据源：Google Sheets / IBKR 待重新授权</span></footer>
    </main>
  );
}
