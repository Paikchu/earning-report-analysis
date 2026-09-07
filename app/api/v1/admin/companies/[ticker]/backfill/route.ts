import { hasSecAdminAccess, requestSecBackfill } from "../../../../../../../lib/web/sec-api.ts";
import { normalizeTrackedTicker } from "../../../../../../../lib/web/ticker.ts";
import { getSecRuntimeConfig } from "../../../../../../../lib/web/sec-runtime.ts";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasSecAdminAccess(request, runtime.adminToken)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticker = normalizeTrackedTicker((await context.params).ticker);
  // The whitelist lives on the Pipeline Worker now; it re-checks this ticker before starting a run.
  return requestSecBackfill({ ticker, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey, fetcher: runtime.pipelineFetch });
}
