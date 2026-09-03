import { getD1 } from "@/db";
import { buildCompanyAnalysisPacket, type CompanyAnalysisPacketStage } from "@/lib/company-analysis/packet";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { isTrackedTicker, normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权读取公司分析输入。" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as {
    ticker?: string;
    periodId?: string;
    memoryVersion?: number;
    packetStage?: CompanyAnalysisPacketStage;
  } | null;
  const ticker = normalizeTrackedTicker(body?.ticker ?? "");
  const stage = body?.packetStage;
  if (!ticker || !isTrackedTicker(ticker, runtime.trackedTickers)) {
    return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  }
  if (!body?.periodId || !Number.isInteger(body.memoryVersion) || (stage !== "current_quarter" && stage !== "cross_period")) {
    return Response.json({ error: "公司分析输入请求无效。" }, { status: 400 });
  }
  try {
    const packet = await buildCompanyAnalysisPacket({
      database: await getD1(),
      rawTicker: ticker,
      periodId: body.periodId,
      memoryVersion: body.memoryVersion!,
      stage,
    });
    return Response.json({ packet }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "公司分析输入组装失败。" }, { status: 409 });
  }
}
