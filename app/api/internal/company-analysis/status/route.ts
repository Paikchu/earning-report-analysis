import { getD1 } from "@/db";
import { COMPANY_ANALYSIS_PROMPT_VERSION } from "@/lib/company-analysis/contracts";
import { D1CompanyAnalysisRepository, type CompanyAnalysisRunUpdate } from "@/lib/company-analysis/repository";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { isTrackedTicker, normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权更新公司分析状态。" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as Partial<CompanyAnalysisRunUpdate> | null;
  const ticker = normalizeTrackedTicker(body?.ticker ?? "");
  if (!ticker || !isTrackedTicker(ticker, runtime.trackedTickers)) {
    return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  }
  if (!body?.analysisId || !body.triggerRef || !body.periodId || !Number.isInteger(body.memoryVersion) || !body.status) {
    return Response.json({ error: "公司分析状态无效。" }, { status: 400 });
  }
  await new D1CompanyAnalysisRepository(await getD1()).upsertRun({
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
