import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository, type SecAnalysisJobUpdate } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecTicker } from "@/lib/sec";
import { isTrackedTicker } from "@/lib/sec-config";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权更新 SEC 任务。" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    job?: SecAnalysisJobUpdate;
    lookup?: { ticker?: string; accessionNumber?: string; analysisVersion?: string };
  } | null;
  if (body?.lookup) {
    const ticker = cleanSecTicker(body.lookup.ticker ?? "");
    if (!ticker || !body.lookup.accessionNumber || !body.lookup.analysisVersion) {
      return Response.json({ error: "SEC 任务查询无效。" }, { status: 400 });
    }
    if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    const status = await new D1SecRepository(await getD1()).getAnalysisJobStatus(ticker, body.lookup.accessionNumber, body.lookup.analysisVersion);
    return Response.json({ status }, { headers: { "cache-control": "no-store" } });
  }
  const job = body?.job;
  const ticker = cleanSecTicker(job?.ticker ?? "");
  if (!job || !job.jobId || !job.accessionNumber || !ticker) return Response.json({ error: "SEC 任务状态无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  await new D1SecRepository(await getD1()).upsertAnalysisJob({ ...job, ticker });
  return Response.json({ status: "stored", jobId: job.jobId }, { headers: { "cache-control": "no-store" } });
}
