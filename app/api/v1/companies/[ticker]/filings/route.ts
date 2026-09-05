import { proxyAnalysisRead } from "@/lib/analysis-proxy";

/**
 * Compatibility proxy. The URL, the pagination semantics and the anonymous access are unchanged;
 * the data now comes from the analysis backend rather than from a database binding in this Worker.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const url = new URL(request.url);
  return proxyAnalysisRead(request, (client) => client.listFilings(ticker, {
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  }));
}
