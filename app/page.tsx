import earningsData from "@/data/earnings-calendar.json";
import dailyReviewData from "@/data/daily-portfolio-review.json";
import snapshotData from "@/data/portfolio-snapshot.json";
import type { DailyPortfolioReviewV1 } from "@/lib/daily-portfolio-review";
import type { EarningsCalendarSnapshot } from "@/lib/earnings-calendar";
import { buildHeatmapHoldings } from "@/lib/portfolio-heatmap";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import { buildPortfolioViewModel } from "@/lib/portfolio-view-model";
import { PortfolioDashboard } from "./portfolio-dashboard";

const snapshot = snapshotData as PortfolioSnapshotV1;
const earnings = earningsData as EarningsCalendarSnapshot;
const dailyReview = dailyReviewData as DailyPortfolioReviewV1;
const heatmapHoldings = buildHeatmapHoldings(snapshot);
const portfolio = buildPortfolioViewModel(snapshot);
const optionUnrealizedPnl = snapshot.positions
  .filter((position) => position.assetClass === "OPT")
  .reduce((sum, position) => sum + position.unrealizedPnl, 0);
const netLiquidationWithoutOptionPnl = snapshot.account.netLiquidation - optionUnrealizedPnl;
const grossPositionsValue = snapshot.positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
const portfolioLeverage = snapshot.account.netLiquidation === 0 ? 0 : grossPositionsValue / snapshot.account.netLiquidation;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <PortfolioDashboard
          dailyReview={dailyReview}
          heatmapHoldings={heatmapHoldings}
          positionGroups={portfolio.positionGroups}
          stockMarketValue={portfolio.stockMarketValue}
          optionMarketValue={portfolio.optionMarketValue}
          netPositionsValue={portfolio.netPositionsValue}
          earningsEvents={earnings.events}
          netLiquidation={snapshot.account.netLiquidation}
          netLiquidationWithoutOptionPnl={netLiquidationWithoutOptionPnl}
          portfolioLeverage={portfolioLeverage}
          netDeposits={snapshot.account.netDeposits}
          cashBalance={snapshot.account.cashBalance}
        />
      </main>
    </>
  );
}
