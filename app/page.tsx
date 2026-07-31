import earningsData from "@/data/earnings-calendar.json";
import snapshotData from "@/data/portfolio-snapshot.json";
import type { EarningsCalendarSnapshot } from "@/lib/earnings-calendar";
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
const optionUnrealizedPnl = snapshot.positions
  .filter((position) => position.assetClass === "OPT")
  .reduce((sum, position) => sum + position.unrealizedPnl, 0);
const netLiquidationWithoutOptionPnl = snapshot.account.netLiquidation - optionUnrealizedPnl;
const snapshotTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(snapshot.generatedAt));

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <PortfolioDashboard
          heatmapHoldings={heatmapHoldings}
          positionGroups={portfolio.positionGroups}
          stockMarketValue={portfolio.stockMarketValue}
          optionMarketValue={portfolio.optionMarketValue}
          netPositionsValue={portfolio.netPositionsValue}
          snapshotTime={snapshotTime}
          earningsEvents={earnings.events}
          netLiquidation={snapshot.account.netLiquidation}
          totalPnl={totalPnl}
          totalPnlRate={totalPnlRate}
          netLiquidationWithoutOptionPnl={netLiquidationWithoutOptionPnl}
          netDeposits={snapshot.account.netDeposits}
          cashBalance={snapshot.account.cashBalance}
        />
      </main>
    </>
  );
}
