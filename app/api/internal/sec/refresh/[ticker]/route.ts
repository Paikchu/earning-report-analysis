import { hasInternalSecAccess, requestSecAnalysis } from "@/lib/sec-api";
import { isTrackedTicker, normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权执行 SEC 刷新。" }, { status: 401 });
  }
  const ticker = normalizeTrackedTicker((await context.params).ticker);
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  return requestSecAnalysis({ ticker, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey, fetcher: runtime.pipelineFetch });
}
