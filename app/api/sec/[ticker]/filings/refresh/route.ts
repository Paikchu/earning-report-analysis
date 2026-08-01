import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { isSecFeedRefreshDue } from "@/lib/sec";
import { getCachedSecFeed, refreshSecTicker } from "@/lib/sec-service";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { D1SecRepository } from "@/lib/sec-d1";
import { findSecurity } from "@/lib/site-data";

export async function POST(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  if (!await getChatGPTUser()) return Response.json({ error: "登录状态已失效。" }, { status: 401 });
  const { ticker } = await context.params;
  const security = findSecurity(ticker);
  if (!security) return Response.json({ error: "未找到对应的美股或 ETF。" }, { status: 404 });
  if (security.type === "etf") {
    return Response.json({ ticker: security.symbol, status: "not_applicable", filings: [] });
  }

  const repository = new D1SecRepository(await getD1());
  const cached = await getCachedSecFeed(repository, security.symbol);
  if (!isSecFeedRefreshDue(cached)) {
    return Response.json(cached, { headers: { "cache-control": "private, no-store" } });
  }

  try {
    const feed = await refreshSecTicker(repository, security.symbol, await getSecRuntimeConfig());
    return Response.json(feed, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "SEC 数据暂时无法更新。" }, { status: 502 });
  }
}
