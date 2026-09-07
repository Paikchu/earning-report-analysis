import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { buildCompanyAnalysisPacket, type CompanyAnalysisPacketStage } from "../company-analysis/packet.ts";
import { isTrackedTicker, normalizeTrackedTicker } from "../sec/config.ts";

export async function readCompanyAnalysisPacket(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as {
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
      database: env.DB,
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
