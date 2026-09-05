import { notFound } from "next/navigation";
import { getAnalysisBackendRuntime } from "@/lib/analysis-backend-runtime";
import { isAnalysisErrorBody } from "@/lib/analysis-contract/client";
import type { PublicFilingDetail } from "@/lib/analysis-contract/filings";
import { findSecurity } from "@/lib/site-data";
import { normalizeTrackedTicker } from "@/lib/sec-config";
import { SecReportDocument } from "@/app/positions/[ticker]/sec/[accession]/SecReportDocument";

export const dynamic = "force-dynamic";

/**
 * Server-rendered report page. It reads through the backend client like every other consumer —
 * there is no database binding in this Worker to fall back to, and deliberately so: a silent
 * fallback would have preserved exactly the coupling this refactor removed.
 */
export default async function StockSecReportPage({ params }: { params: Promise<{ ticker: string; accession: string }> }) {
  const route = await params;
  const ticker = normalizeTrackedTicker(route.ticker);
  const result = await loadFiling(ticker, route.accession);
  if (result === "unavailable") throw new Error("The analysis backend is unavailable.");
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

/**
 * Three outcomes, kept apart on purpose: the filing, a genuine 404, and a backend that could not
 * answer. Collapsing the third into the second would render an outage as "this report does not
 * exist", which is the one thing a reader must not be told when it is untrue.
 */
async function loadFiling(ticker: string, accession: string): Promise<PublicFilingDetail | null | "unavailable"> {
  if (!ticker) return null;
  const runtime = await getAnalysisBackendRuntime();
  if (!runtime.configured) {
    console.error(JSON.stringify({ event: "analysis-backend-unconfigured", reason: runtime.reason }));
    return "unavailable";
  }
  try {
    const response = await runtime.client.getFiling(ticker, accession);
    if (response.status === 404) return null;
    if (response.status !== 200 || isAnalysisErrorBody(response.body)) {
      console.error(JSON.stringify({ event: "analysis-backend-refused", status: response.status }));
      return "unavailable";
    }
    return response.body as PublicFilingDetail;
  } catch {
    return "unavailable";
  }
}
