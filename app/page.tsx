import snapshotData from "@/data/portfolio-snapshot.json";
import { PortfolioHeatmap } from "@/app/portfolio-heatmap";
import { buildHeatmapHoldings } from "@/lib/portfolio-heatmap";
import { buildPortfolioViewModel } from "@/lib/portfolio-view-model";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import Link from "next/link";
import { AddPlanDialog } from "./AddPlanDialog";

const snapshot = snapshotData as PortfolioSnapshotV1;
const heatmapHoldings = buildHeatmapHoldings(snapshot);
const { positionGroups, stockMarketValue, optionMarketValue, netPositionsValue } = buildPortfolioViewModel(snapshot);
const allocation = positionGroups.filter((group) => group.weight > 0).slice(0, 4).map((group) => [group.symbol, group.weight] as const);
const totalPnl = snapshot.account.netLiquidation - snapshot.account.netDeposits;
const topFourWeight = allocation.reduce((sum, [, weight]) => sum + weight, 0);
const allocationStops = allocation
  .map(([, weight]) => weight)
  .reduce<number[]>((stops, weight) => [...stops, (stops.at(-1) ?? 0) + weight], []);
const donutBackground = `conic-gradient(var(--ink) 0 ${allocationStops[0] ?? 0}%, #718196 ${allocationStops[0] ?? 0}% ${allocationStops[1] ?? 0}%, var(--vermilion) ${allocationStops[1] ?? 0}% ${allocationStops[2] ?? 0}%, #b47d64 ${allocationStops[2] ?? 0}% ${allocationStops[3] ?? 0}%, var(--paper-deep) ${allocationStops[3] ?? 0}% 100%)`;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: number, sign = false) => {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
};

const formatNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 6) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits }).format(value);

function Pnl({ value, currency = true }: { value: number; currency?: boolean }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  const prefix = value < 0 ? "−" : value > 0 ? "+" : "";
  const content = currency ? money(value, true) : `${prefix}${formatNumber(Math.abs(value), 2, 6)}`;
  return <span className={className}>{content}</span>;
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <section className="hero" aria-labelledby="portfolio-title">
              <div className="portfolio-heading">
                <h1 id="portfolio-title">投资组合</h1>
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
                <h2>仓位构成</h2>
                <div className="section-divider" aria-hidden="true" />
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
                <PortfolioHeatmap holdings={heatmapHoldings} />
              </aside>

              <section className="ledger-panel" aria-labelledby="ledger-title">
                <div className="ledger-heading">
                  <h2 id="ledger-title">投资账本</h2>
                  <AddPlanDialog />
                </div>
                <div className="section-divider" aria-hidden="true" />

                  <div className="ledger-content">
                    <div className="ledger-meta">
                      <span>持仓净市值 <strong>{money(netPositionsValue)}</strong></span>
                      <span>正股 <strong>{money(stockMarketValue)}</strong></span>
                      <span>期权 <strong>{money(optionMarketValue)}</strong></span>
                    </div>
                    <div className="position-scroll" aria-label="按 Ticker 分类的持仓">
                      <div className="position-columns" aria-hidden="true">
                        <span>标的</span><span>构成</span><span>净市值</span><span>净权重</span><span>持仓成本</span><span>未实现盈亏</span><span>年内已实现</span><span>年内净盈亏</span><span />
                      </div>
                      <div className="position-list">
                        {positionGroups.map((group) => (
                          <Link className="position-row" href={`/positions/${encodeURIComponent(group.symbol)}`} key={group.symbol}>
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
                              <span className="row-arrow" aria-hidden="true">→</span>
                          </Link>
                        ))}
                        {positionGroups.length === 0 && <p className="empty-state">当前快照没有持仓。</p>}
                      </div>
                    </div>
                  </div>
          </section>
        </section>
      </main>
    </>
  );
}
