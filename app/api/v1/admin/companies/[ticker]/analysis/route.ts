import { hasSecAdminAccess, requestSecAnalysis } from "../../../../../../../lib/web/sec-api.ts";
import { normalizeTrackedTicker } from "../../../../../../../lib/web/ticker.ts";
import { getSecRuntimeConfig } from "../../../../../../../lib/web/sec-runtime.ts";

/**
 * Re-runs the company analysis behind the business outlook.
 *
 * Its sibling `refresh` drives the filing workflow. This one exists because the outlook workflow
 * has no other manual entry: the Cron sweep skips a company that already has a published run for
 * the current memory version, so a prompt or model change stays invisible until a filing advances
 * memory. This is how that change gets looked at without waiting a quarter for one.
 */
export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasSecAdminAccess(request, runtime.adminToken)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticker = normalizeTrackedTicker((await context.params).ticker);
  // The whitelist lives on the Pipeline Worker; it re-checks this ticker before starting a run.
  return requestSecAnalysis({
    ticker,
    pipelineOrigin: runtime.pipelineOrigin,
    refreshKey: runtime.refreshKey,
    fetcher: runtime.pipelineFetch,
    path: "company-analysis",
  });
}
