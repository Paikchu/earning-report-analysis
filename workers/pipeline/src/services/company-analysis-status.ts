import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { COMPANY_ANALYSIS_PROMPT_VERSION } from "../company-analysis/contracts.ts";
import { D1CompanyAnalysisRepository, type CompanyAnalysisRunUpdate } from "../company-analysis/repository.ts";
import { isTrackedTicker, normalizeTrackedTicker } from "../sec/config.ts";

export async function updateCompanyAnalysisStatus(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as Partial<CompanyAnalysisRunUpdate> | null;
  const ticker = normalizeTrackedTicker(body?.ticker ?? "");
  if (!ticker || !isTrackedTicker(ticker, runtime.trackedTickers)) {
    return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  }
  if (!body?.analysisId || !body.triggerRef || !body.periodId || !Number.isInteger(body.memoryVersion) || !body.status) {
    return Response.json({ error: "公司分析状态无效。" }, { status: 400 });
  }
  await new D1CompanyAnalysisRepository(env.DB).upsertRun({
    analysisId: body.analysisId,
    ticker,
    triggerRef: body.triggerRef,
    periodId: body.periodId,
    inputHash: body.inputHash,
    memoryVersion: body.memoryVersion!,
    fundamentalsDataVersion: body.fundamentalsDataVersion,
    status: body.status,
    coverageStatus: body.coverageStatus,
    modelVersion: body.modelVersion || "runtime-model",
    promptVersion: body.promptVersion || COMPANY_ANALYSIS_PROMPT_VERSION,
    errorCode: body.errorCode,
    errorDetail: body.errorDetail,
    updatedAt: body.updatedAt || new Date().toISOString(),
  });
  return Response.json({ status: "stored", analysisId: body.analysisId }, { headers: { "cache-control": "no-store" } });
}
