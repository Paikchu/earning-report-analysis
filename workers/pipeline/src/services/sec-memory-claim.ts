import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository } from "../sec/d1.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function claimSecMemory(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as { jobId?: string; ownerToken?: string } | null;
  const ownerToken = String(body?.ownerToken ?? "");
  if (!ownerToken || ownerToken.length > 160) return Response.json({ error: "Memory owner token 无效。" }, { status: 400 });
  const claim = await new D1SecRepository(env.DB).claimMemoryJob(body?.jobId ?? null, ownerToken, new Date(), undefined, runtime.trackedTickers);
  if (claim && !isTrackedTicker(claim.ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  return Response.json({ claim }, { headers: { "cache-control": "no-store" } });
}
