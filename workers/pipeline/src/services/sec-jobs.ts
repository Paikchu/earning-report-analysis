import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository, type SecAnalysisJobUpdate } from "../sec/d1.ts";
import { cleanSecTicker } from "../sec/sec.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function updateSecJob(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as {
    job?: SecAnalysisJobUpdate;
    lookup?: { ticker?: string; accessionNumber?: string; analysisVersion?: string };
  } | null;
  if (body?.lookup) {
    const ticker = cleanSecTicker(body.lookup.ticker ?? "");
    if (!ticker || !body.lookup.accessionNumber || !body.lookup.analysisVersion) {
      return Response.json({ error: "SEC 任务查询无效。" }, { status: 400 });
    }
    if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    const status = await new D1SecRepository(env.DB).getAnalysisJobStatus(ticker, body.lookup.accessionNumber, body.lookup.analysisVersion);
    return Response.json({ status }, { headers: { "cache-control": "no-store" } });
  }
  const job = body?.job;
  const ticker = cleanSecTicker(job?.ticker ?? "");
  if (!job || !job.jobId || !job.accessionNumber || !ticker) return Response.json({ error: "SEC 任务状态无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  await new D1SecRepository(env.DB).upsertAnalysisJob({ ...job, ticker });
  return Response.json({ status: "stored", jobId: job.jobId }, { headers: { "cache-control": "no-store" } });
}
