import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecTicker, type SecFiling } from "@/lib/sec";
import type { SecHistorySnapshot } from "@/lib/sec-analysis";
import { isTrackedTicker } from "@/lib/sec-config";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权读取 SEC 分析上下文。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { filing?: SecFiling; history?: SecHistorySnapshot } | null;
  const filing = body?.filing;
  const ticker = cleanSecTicker(filing?.ticker ?? "");
  if (!filing || !filing.accessionNumber || !ticker) return Response.json({ error: "SEC filing 无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  const repository = new D1SecRepository(await getD1());
  if (body?.history) await repository.saveHistory({ ...filing, ticker }, body.history);
  const context = await repository.getAnalysisContext({ ...filing, ticker });
  return Response.json({ context }, { headers: { "cache-control": "no-store" } });
}
