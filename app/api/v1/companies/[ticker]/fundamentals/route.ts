import { proxyAnalysisRead } from "@/lib/analysis-proxy";

/**
 * Reading fundamentals no longer schedules anything. The staleness refresh this route used to
 * trigger on every read now runs on the backend's Cron sweep, so a page load cannot start an
 * outbound Yahoo fetch and a database write any more.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const url = new URL(request.url);
  return proxyAnalysisRead(request, (client) => client.getFundamentals(ticker, {
    metrics: url.searchParams.get("metrics"),
    periodCount: url.searchParams.get("periodCount"),
  }));
}
