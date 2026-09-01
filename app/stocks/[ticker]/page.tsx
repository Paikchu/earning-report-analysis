import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/site-header";
import { findSecurity } from "@/lib/site-data";
import { normalizeTrackedTicker } from "@/lib/sec-config";
import { SecFilingsSection } from "@/app/positions/[ticker]/SecFilingsSection";
import { BusinessOutlook } from "./BusinessOutlook";
import { FundamentalCharts } from "./FundamentalCharts";
import {
  hasExplicitFundamentalPageState,
  parseFundamentalPageState,
  stockPageSearchParamsToUrlSearchParams,
  type StockPageSearchParams,
} from "@/lib/fundamental-page-state";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<StockPageSearchParams>;
}) {
  const ticker = normalizeTrackedTicker((await params).ticker);
  if (!ticker) notFound();
  const security = findSecurity(ticker);
  const normalizedSearchParams = stockPageSearchParamsToUrlSearchParams(await searchParams);
  const initialState = parseFundamentalPageState(normalizedSearchParams);
  const initialPreferenceSource = hasExplicitFundamentalPageState(normalizedSearchParams)
    ? "url"
    : "preset";
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
            <FundamentalCharts
              ticker={ticker}
              companyName={security?.name ?? ticker}
              initialState={initialState}
              initialPreferenceSource={initialPreferenceSource}
            />
          </div>
          <div className="stock-analysis-filings">
            <SecFilingsSection ticker={ticker} title="披露时间线" />
          </div>
        </div>
      </main>
    </div>
  );
}
