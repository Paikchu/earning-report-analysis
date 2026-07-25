import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { refreshSecTicker } from "@/lib/sec-service";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { findSecurity } from "@/lib/site-data";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权执行 SEC 刷新。" }, { status: 401 });
  }
  const { ticker } = await context.params;
  const security = findSecurity(ticker);
  if (!security) return Response.json({ error: "未找到对应的美股或 ETF。" }, { status: 404 });
  if (security.type === "etf") {
    return Response.json({ ticker: security.symbol, status: "not_applicable", filings: [] });
  }
  try {
    const feed = await refreshSecTicker(new D1SecRepository(await getD1()), security.symbol, runtime);
    return Response.json(feed, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "SEC 数据暂时无法更新。" }, { status: 502 });
  }
}
