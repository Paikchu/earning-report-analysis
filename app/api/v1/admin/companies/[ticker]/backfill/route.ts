import { hasSecAdminAccess, requestSecBackfill } from "@/lib/sec-api";
import { isTrackedTicker, normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasSecAdminAccess(request, runtime.adminToken)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticker = normalizeTrackedTicker((await context.params).ticker);
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  return requestSecBackfill({ ticker, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey });
}
