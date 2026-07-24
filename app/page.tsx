import earningsData from "@/data/earnings-calendar.json";
import snapshotData from "@/data/portfolio-snapshot.json";
import type { EarningsCalendarSnapshot } from "@/lib/earnings-calendar";
import { money, percent } from "@/lib/portfolio-format";
import { buildHeatmapHoldings } from "@/lib/portfolio-heatmap";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import { buildPortfolioViewModel } from "@/lib/portfolio-view-model";
import { PortfolioDashboard } from "./portfolio-dashboard";

const snapshot = snapshotData as PortfolioSnapshotV1;
const earnings = earningsData as EarningsCalendarSnapshot;
const heatmapHoldings = buildHeatmapHoldings(snapshot);
const portfolio = buildPortfolioViewModel(snapshot);
const totalPnl = snapshot.account.netLiquidation - snapshot.account.netDeposits;
const totalPnlRate = snapshot.account.netDeposits === 0 ? 0 : totalPnl / snapshot.account.netDeposits * 100;
const snapshotTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(snapshot.generatedAt));

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <section className="hero" aria-labelledby="portfolio-title">
          <div className="portfolio-heading">
            <h1 id="portfolio-title">投资组合</h1>
            <span className="summary-nav-label">当前净值</span>
            <strong className="summary-nav-value">{money(snapshot.account.netLiquidation)}</strong>
            <span className={`pnl-pill ${totalPnl < 0 ? "loss" : totalPnl > 0 ? "gain" : "muted"}`}>
              {money(totalPnl, true)}（{percent(totalPnlRate, true)}）
            </span>
          </div>
          <div className="summary-support" aria-label="组合摘要">
            <article><span>净入金</span><strong>{money(snapshot.account.netDeposits)}</strong></article>
            <article><span>现金</span><strong>{money(snapshot.account.cashBalance)}</strong></article>
          </div>
        </section>

        <PortfolioDashboard
          heatmapHoldings={heatmapHoldings}
          positionGroups={portfolio.positionGroups}
          stockMarketValue={portfolio.stockMarketValue}
          optionMarketValue={portfolio.optionMarketValue}
          netPositionsValue={portfolio.netPositionsValue}
          snapshotTime={snapshotTime}
          earningsEvents={earnings.events}
          earningsUpdatedAt={earnings.generatedAt}
        />
      </main>
    </>
  );
}
