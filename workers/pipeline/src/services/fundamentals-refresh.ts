import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1FundamentalsRepository } from "../fundamentals/fundamentals-d1.ts";
import { FundamentalSyncService } from "../fundamentals/fundamental-sync.ts";
import { FundamentalSyncInProgressError } from "../fundamentals/fundamentals-d1.ts";
import { isTrackedTicker, normalizeTrackedTicker } from "../sec/config.ts";

export async function refreshFundamentals(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as {
    ticker?: string;
    targetPeriodEnd?: string;
    triggerRef?: string;
  } | null;
  const ticker = normalizeTrackedTicker(body?.ticker ?? "");
  const targetPeriodEnd = String(body?.targetPeriodEnd ?? "");
  if (!ticker || !isTrackedTicker(ticker, runtime.trackedTickers)) {
    return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetPeriodEnd) || !body?.triggerRef) {
    return Response.json({ error: "基本面刷新请求无效。" }, { status: 400 });
  }
  const repository = new D1FundamentalsRepository(env.DB);
  let scheduled = false;
  try {
    await new FundamentalSyncService(repository).syncTicker(ticker);
    scheduled = true;
  } catch (error) {
    if (!(error instanceof FundamentalSyncInProgressError)) throw error;
  }
  const snapshot = await repository.getLastGoodSnapshot(ticker);
  const quarters = snapshot?.observations.filter((item) => item.periodType === "3M") ?? [];
  const latestPeriodEnd = quarters.map((item) => item.periodEnd).sort().at(-1) ?? null;
  const targetReady = quarters.some((item) =>
    item.periodEnd === targetPeriodEnd && item.metricKey === "total_revenue");
  return Response.json({
    syncStatus: scheduled ? "scheduled" : "unchanged",
    targetReady,
    latestPeriodEnd,
    qualityStatus: snapshot?.qualityStatus ?? null,
    dataVersion: snapshot?.payloadHash ?? null,
  }, { headers: { "cache-control": "no-store" } });
}
