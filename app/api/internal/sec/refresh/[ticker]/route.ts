import { hasInternalSecAccess, requestSecAnalysis } from "@/lib/sec-api";
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
  return requestSecAnalysis({ ticker: security.symbol, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey });
}
