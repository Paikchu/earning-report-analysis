import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { normalizeCompanyAnalysisPublication } from "../company-analysis/contracts.ts";
import { D1CompanyAnalysisRepository } from "../company-analysis/repository.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function publishCompanyAnalysis(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  try {
    const publication = normalizeCompanyAnalysisPublication(input);
    if (!isTrackedTicker(publication.ticker, runtime.trackedTickers)) {
      return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    }
    const result = await new D1CompanyAnalysisRepository(env.DB).publish(publication);
    return Response.json({
      status: result.duplicate ? "duplicate" : "ready",
      analysisId: result.publication.analysisId,
      ticker: result.publication.ticker,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "公司分析发布失败。" }, { status: 400 });
  }
}
