import { hasInternalSecAccess, requestSecAnalysis } from "@/lib/sec-api";
import { normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权执行 SEC 刷新。" }, { status: 401 });
  }
  const ticker = normalizeTrackedTicker((await context.params).ticker);
  // The whitelist lives on the Pipeline Worker now; it re-checks this ticker before starting a run.
  return requestSecAnalysis({ ticker, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey, fetcher: runtime.pipelineFetch });
}
