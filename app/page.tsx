"use client";

import { useState } from "react";

type Tab = "总览" | "持仓" | "交易" | "分析";

const holdings = [
  { symbol: "BOXX", name: "Alpha Architect 1–3 Month Box ETF", averageCost: 117.04128389, quantity: 180, weight: 31.11873600867634, unrealized: 80.76889979999862, realized: 1.063786, price: 117.49, value: 21148.2, cost: 21067.4311002 },
  { symbol: "MSFT", name: "Microsoft", averageCost: 429.8370129, quantity: 40.0455, weight: 23.205986103567028, unrealized: -1442.3192900869499, realized: 0, price: 393.82, value: 15770.718809999998, cost: 17213.03810008695 },
  { symbol: "TSLA", name: "Tesla", averageCost: 389.25858667, quantity: 15, weight: 8.405863918591863, unrealized: -126.27880005000037, realized: -44.802037, price: 380.84, value: 5712.599999999999, cost: 5838.87880005 },
  { symbol: "NVDA", name: "NVIDIA", averageCost: 203.64195169, quantity: 35.0179, weight: 10.450281823672995, unrealized: -29.133201085251383, realized: 0.195499, price: 202.81, value: 7101.980299, cost: 7131.113500085251 },
  { symbol: "BATS:DRAM", name: "L&G Cyber Security UCITS ETF", averageCost: 63.18814714, quantity: 70, weight: 5.430276967610442, unrealized: -732.7702998, realized: 0, price: 52.72, value: 3690.4, cost: 4423.1702998 },
  { symbol: "ORCL", name: "Oracle", averageCost: 144.58873333, quantity: 27, weight: 5.022196891893066, unrealized: -490.82579991, realized: 264.609827, price: 126.41, value: 3413.0699999999997, cost: 3903.89579991 },
  { symbol: "AVGO", name: "Broadcom", averageCost: 384.11674113, quantity: 7.0061, weight: 3.822959810291851, unrealized: -93.08823703089297, realized: 42.609106, price: 370.83, value: 2598.072063, cost: 2691.160300030893 },
  { symbol: "NOK", name: "Nokia", averageCost: 14.7011045, quantity: 200, weight: 2.978235579461179, unrealized: -916.2209, realized: 102.2937, price: 10.12, value: 2023.9999999999998, cost: 2940.2209 },
  { symbol: "NOW", name: "ServiceNow", averageCost: 107.699015, quantity: 20, weight: 3.0382711583356925, unrealized: -89.18030000000016, realized: 0, price: 103.24, value: 2064.7999999999997, cost: 2153.9803 },
  { symbol: "RKLB", name: "Rocket Lab", averageCost: 81.52225333, quantity: 15, weight: 1.4925021483436137, unrealized: -208.5337999499999, realized: 725.296967, price: 67.62, value: 1014.3000000000001, cost: 1222.83379995 },
  { symbol: "MRVL", name: "Marvell Technology", averageCost: 267.67026, quantity: 5, weight: 1.3881756154464806, unrealized: -394.9512999999999, realized: 0, price: 188.68, value: 943.4000000000001, cost: 1338.3512999999998 },
  { symbol: "SPCX", name: "Space Innovation ETF", averageCost: 148.72026, quantity: 5, weight: 0.9122317922366393, unrealized: -123.6513, realized: 44.825092, price: 123.99, value: 619.9499999999999, cost: 743.6013 },
  { symbol: "MSTR", name: "Strategy", averageCost: 137.91929432, quantity: 7, weight: 0.9769760439640562, unrealized: -301.48506024000005, realized: 0, price: 94.85, value: 663.9499999999999, cost: 965.43506024 },
];

const optionContracts = [
  { contract: "INTC Nov 20 ’26 70 Put", quantity: -1, cost: -492.87, marketValue: 56.08, unrealized: 72.2 },
  { contract: "NOK Jul 24 ’26 16 Call", quantity: -1, cost: -11.47, marketValue: 14.48, unrealized: 9.23 },
  { contract: "NOK Jul 31 ’26 16 Call", quantity: -1, cost: -18.15, marketValue: 78.8, unrealized: 72.25 },
  { contract: "NVDA Jan 15 ’27 180 Put", quantity: -1, cost: -1083.65, marketValue: 650.26, unrealized: 427.97 },
  { contract: "RKLB Oct 16 ’26 70 Put", quantity: -1, cost: -977.65, marketValue: -113.46, unrealized: -2.69 },
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

      {activeTab === "总览" && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <h1>投资组合</h1>
              <div className="nav-label">当前净值</div>
              <div className="nav-value">$67,119.06</div>
            </div>

            <div className="capital-landing">
              <div className="section-head">
                <h2>净值对照</h2>
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
            </div>
          </section>

          <section className="metrics" aria-label="组合摘要">
            <article className="metric"><span>净入金</span><strong>$71,563.39</strong></article>
            <article className="metric metric-loss"><span>总盈亏</span><strong>−$4,444.33</strong></article>
            <article className="metric"><span>现金</span><strong>$1,291.46</strong></article>
          </section>

          <section className="lower-grid">
            <aside className="allocation-panel">
              <div className="ruled-heading"><h2>仓位构成</h2></div>
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
                <h2>核心持仓</h2>
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
          <div className="detail-stats"><span><small>正股市值</small><strong>$66,765.44</strong></span><span><small>前两大权重</small><strong>54.33%</strong></span><span><small>期权合约</small><strong>5</strong></span></div>
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
              <tbody>{filteredTrades.map((trade, index) => <tr key={`${trade.time}-${trade.symbol}-${index}`}><td>{trade.time}</td><td><strong className="symbol">{trade.symbol}</strong></td><td>{trade.type === "OPT" ? "期权" : "正股"}</td><td><span className={`side side-${trade.side}`}>{trade.side}</span></td><td>{trade.size}</td><td>{money(trade.price)}</td><td><Pnl value={trade.pnl} /></td></tr>)}</tbody>
            </table>
          </div>
          <p className="data-footnote">显示最近 10 笔投资交易 · 源表共 398 行，包含换汇流水</p>
        </section>
      )}

      {activeTab === "分析" && (
        <section className="detail-page analysis-page">
          <div className="detail-intro">
            <h1>持仓分析</h1>
          </div>
          <div className="analysis-grid">
            <article className="analysis-lead"><span>最大未实现亏损</span><strong>MSFT</strong><Pnl value={-1442.32} /><p>组合权重 23.21%</p></article>
            <article><span>最大已实现收益</span><strong>RKLB</strong><Pnl value={725.3} /><p>当前权重 1.49%</p></article>
            <article><span>BOXX + 现金</span><strong>$22,439.66</strong><p>占 NAV 33.43%</p></article>
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

      <footer><span>MAX · 投资记录</span><span>数据源：Google Sheets / IBKR 待重新授权</span></footer>
    </main>
  );
}
