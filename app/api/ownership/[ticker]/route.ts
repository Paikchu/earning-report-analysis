import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { D1SecRepository } from "@/lib/sec-d1";
import { findSecurity } from "@/lib/site-data";
import { refreshOwnership } from "@/lib/ownership-service";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  if (!await getChatGPTUser()) return Response.json({ error: "登录状态已失效。" }, { status: 401 });

  const { ticker } = await context.params;
  const security = findSecurity(ticker);
  if (!security) return Response.json({ error: "未找到对应的美股或 ETF。" }, { status: 404 });
  if (security.type === "etf") {
    return Response.json({ ticker: security.symbol, status: "not_applicable" }, { headers: { "cache-control": "private, no-store" } });
  }

  const feed = await refreshOwnership(new D1SecRepository(await getD1()), security.symbol);
  return Response.json(feed, { headers: { "cache-control": "private, no-store" } });
}
