import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/site-header";
import { findSecurity } from "../../../lib/web/site-data.ts";
import { normalizeTrackedTicker } from "../../../lib/web/ticker.ts";
import { SecFilingsSection } from "./SecFilingsSection.tsx";
import { BusinessOutlook } from "./BusinessOutlook";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const ticker = normalizeTrackedTicker((await params).ticker);
  if (!ticker) notFound();
  const security = findSecurity(ticker);
  return (
    <div className="sec-app-shell stock-analysis-shell">
      <SiteHeader initialQuery={security?.symbol ?? ticker} />
      <main className="stock-analysis-page">
        <div className="stock-analysis-grid">
          <div className="stock-analysis-primary">
            <header className="stock-analysis-header">
              <h1>{security?.name ?? ticker}</h1>
              <span>{ticker}</span>
            </header>
            <BusinessOutlook ticker={ticker} />
          </div>
          <div className="stock-analysis-filings">
            <SecFilingsSection ticker={ticker} title="披露时间线" />
          </div>
        </div>
      </main>
    </div>
  );
}
