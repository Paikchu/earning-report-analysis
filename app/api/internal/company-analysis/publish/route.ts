import { getD1 } from "@/db";
import { normalizeCompanyAnalysisPublication } from "@/lib/company-analysis/contracts";
import { D1CompanyAnalysisRepository } from "@/lib/company-analysis/repository";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { isTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权发布公司分析。" }, { status: 401 });
  }
  try {
    const publication = normalizeCompanyAnalysisPublication(await request.json());
    if (!isTrackedTicker(publication.ticker, runtime.trackedTickers)) {
      return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    }
    const result = await new D1CompanyAnalysisRepository(await getD1()).publish(publication);
    return Response.json({
      status: result.duplicate ? "duplicate" : "ready",
      analysisId: result.publication.analysisId,
      ticker: result.publication.ticker,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "公司分析发布失败。" }, { status: 400 });
  }
}
