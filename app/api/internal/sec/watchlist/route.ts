import { getD1 } from "@/db";
import { buildSecWatchlist, hasInternalSecAccess } from "@/lib/sec-api";
import { listHoldingPlanTickers } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { findSecurity, portfolioViewModel } from "@/lib/site-data";

export async function GET(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权执行 SEC 刷新。" }, { status: 401 });
  }
  const database = await getD1();
  const tickers = buildSecWatchlist(
    portfolioViewModel.positionGroups.map((group) => group.symbol),
    await listHoldingPlanTickers(database),
    (ticker) => findSecurity(ticker)?.type ?? null,
  );
  return Response.json({ tickers }, { headers: { "cache-control": "no-store" } });
}
