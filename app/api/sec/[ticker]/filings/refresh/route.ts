import { getChatGPTUser } from "@/app/chatgpt-auth";
import { requestSecAnalysis } from "@/lib/sec-api";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { findSecurity } from "@/lib/site-data";

export async function POST(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  if (!await getChatGPTUser()) return Response.json({ error: "登录状态已失效。" }, { status: 401 });
  const { ticker } = await context.params;
  const security = findSecurity(ticker);
  if (!security) return Response.json({ error: "未找到对应的美股或 ETF。" }, { status: 404 });
  if (security.type === "etf") {
    return Response.json({ ticker: security.symbol, status: "not_applicable", filings: [] });
  }

  const runtime = await getSecRuntimeConfig();
  return requestSecAnalysis({ ticker: security.symbol, pipelineOrigin: runtime.pipelineOrigin, refreshKey: runtime.refreshKey });
}
