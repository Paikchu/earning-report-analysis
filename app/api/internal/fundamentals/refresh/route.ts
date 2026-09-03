import { getD1 } from "@/db";
import { D1FundamentalsRepository } from "@/lib/fundamentals-d1";
import { scheduleFundamentalRefresh } from "@/lib/fundamentals-runtime";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { isTrackedTicker, normalizeTrackedTicker } from "@/lib/sec-config";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权刷新基本面数据。" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as {
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
  const repository = new D1FundamentalsRepository(await getD1());
  const scheduled = await scheduleFundamentalRefresh(repository, ticker);
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
