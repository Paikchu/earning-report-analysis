import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecTicker, type SecFiling } from "@/lib/sec";
import { findSecurity } from "@/lib/site-data";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权读取 SEC 分析上下文。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { filing?: SecFiling } | null;
  const filing = body?.filing;
  const ticker = cleanSecTicker(filing?.ticker ?? "");
  const security = findSecurity(ticker);
  if (!filing || !filing.accessionNumber || !security || security.type !== "stock") return Response.json({ error: "SEC filing 无效。" }, { status: 400 });
  const context = await new D1SecRepository(await getD1()).getAnalysisContext({ ...filing, ticker });
  return Response.json({ context }, { headers: { "cache-control": "no-store" } });
}
