import { hasInternalSecAccess } from "@/lib/sec-api";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function GET(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权执行 SEC 刷新。" }, { status: 401 });
  }
  return Response.json({ tickers: runtime.trackedTickers }, { headers: { "cache-control": "no-store" } });
}
