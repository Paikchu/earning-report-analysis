import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository } from "../sec/d1.ts";
import { cleanSecTicker, type SecFiling } from "../sec/sec.ts";
import type { SecHistorySnapshot } from "../sec/analysis.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function resolveSecContext(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as { filing?: SecFiling; history?: SecHistorySnapshot } | null;
  const filing = body?.filing;
  const ticker = cleanSecTicker(filing?.ticker ?? "");
  if (!filing || !filing.accessionNumber || !ticker) return Response.json({ error: "SEC filing 无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  const repository = new D1SecRepository(env.DB);
  if (body?.history) await repository.saveHistory({ ...filing, ticker }, body.history);
  const context = await repository.getAnalysisContext({ ...filing, ticker });
  return Response.json({ context }, { headers: { "cache-control": "no-store" } });
}
