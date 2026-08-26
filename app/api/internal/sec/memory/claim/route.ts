import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { isTrackedTicker } from "@/lib/sec-config";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权领取 SEC Memory 任务。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { jobId?: string; ownerToken?: string } | null;
  const ownerToken = String(body?.ownerToken ?? "");
  if (!ownerToken || ownerToken.length > 160) return Response.json({ error: "Memory owner token 无效。" }, { status: 400 });
  const claim = await new D1SecRepository(await getD1()).claimMemoryJob(body?.jobId ?? null, ownerToken, new Date(), undefined, runtime.trackedTickers);
  if (claim && !isTrackedTicker(claim.ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  return Response.json({ claim }, { headers: { "cache-control": "no-store" } });
}
