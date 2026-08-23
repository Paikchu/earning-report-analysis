import earningsData from "@/data/earnings-calendar.json";
import snapshotData from "@/data/portfolio-snapshot.json";
import type { EarningsCalendarSnapshot } from "@/lib/earnings-calendar";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import { buildPortfolioViewModel } from "@/lib/portfolio-view-model";
import { PortfolioLedgerPage } from "../portfolio-dashboard";

const snapshot = snapshotData as PortfolioSnapshotV1;
const earnings = earningsData as EarningsCalendarSnapshot;
const portfolio = buildPortfolioViewModel(snapshot);

export default function LedgerPage() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <PortfolioLedgerPage positionGroups={portfolio.positionGroups} earningsEvents={earnings.events} />
      </main>
    </>
  );
}
