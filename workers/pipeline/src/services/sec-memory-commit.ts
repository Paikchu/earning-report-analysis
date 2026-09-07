import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository, type SecMemoryExtractionPayload, type SecMemoryJobClaim } from "../sec/d1.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function commitSecMemory(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as { claim?: SecMemoryJobClaim; extraction?: SecMemoryExtractionPayload } | null;
  if (!body?.claim?.jobId || !body.claim.ownerToken || !Array.isArray(body.extraction?.candidates)) {
    return Response.json({ error: "SEC Memory 提交内容无效。" }, { status: 400 });
  }
  if (!isTrackedTicker(body.claim.ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  const result = await new D1SecRepository(env.DB).commitMemoryJob(body.claim, body.extraction);
  return Response.json({ status: "committed", ...result }, { headers: { "cache-control": "no-store" } });
}
