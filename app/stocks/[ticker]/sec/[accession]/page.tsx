import { notFound } from "next/navigation";
import { getPublicFiling } from "@/lib/web/analysis-client";
import { findSecurity } from "../../../../../lib/web/site-data.ts";
import { normalizeTrackedTicker } from "@/lib/web/ticker";
import { SecReportDocument } from "@/app/stocks/[ticker]/sec/[accession]/SecReportDocument";

export const dynamic = "force-dynamic";

export default async function StockSecReportPage({ params }: { params: Promise<{ ticker: string; accession: string }> }) {
  const route = await params;
  const ticker = normalizeTrackedTicker(route.ticker);
  const result = await getPublicFiling(ticker, route.accession);
  if (!result) notFound();
  const security = findSecurity(ticker);
  const filing = result.filing;
  return <SecReportDocument companyName={security?.name ?? result.company?.name ?? ticker} filing={{
    ticker,
    cik: result.company?.cik ?? "",
    cikNumber: Number(result.company?.cik ?? 0),
    companyName: security?.name ?? result.company?.name ?? ticker,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    primaryDocument: "",
    description: filing.description,
    items: "",
    documentUrl: filing.documentUrl,
    indexUrl: filing.edgarUrl,
    summary: filing.summary,
    analysis: filing.analysis,
  }} />;
}
