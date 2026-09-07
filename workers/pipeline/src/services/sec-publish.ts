import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository } from "../sec/d1.ts";
import { cleanSecAccession, cleanSecTicker, type SecFiling, type SecFilingSummary } from "../sec/sec.ts";
import type { FilingBlock } from "../sec/analysis.ts";
import type { SecAnalysisArtifact } from "../sec/types.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function publishSecAnalysis(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as {
    artifact?: SecAnalysisArtifact;
    filing?: SecFiling;
    blocks?: FilingBlock[];
    summary?: SecFilingSummary | null;
  } | null;
  const repository = new D1SecRepository(env.DB);
  if (body?.filing && Array.isArray(body.blocks)) {
    const blockTicker = cleanSecTicker(body.filing.ticker);
    const blockAccession = cleanSecAccession(body.filing.accessionNumber);
    if (!blockTicker || !blockAccession) return Response.json({ error: "SEC 证据块无效。" }, { status: 400 });
    if (!isTrackedTicker(blockTicker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    await repository.saveFilingBlocks({ ...body.filing, ticker: blockTicker, accessionNumber: blockAccession }, body.blocks);
    return Response.json({ status: "stored", ticker: blockTicker, count: body.blocks.length }, { headers: { "cache-control": "no-store" } });
  }
  if (body?.filing && body.summary) {
    const eventTicker = cleanSecTicker(body.filing.ticker);
    const eventAccession = cleanSecAccession(body.filing.accessionNumber);
    const validEvent = /^(8-K|6-K)(\/A)?$/.test(body.filing.form)
      && Boolean(eventTicker)
      && body.summary.source === "deepseek"
      && body.summary.ticker === eventTicker
      && body.summary.form === body.filing.form
      && body.summary.accessionNumber === eventAccession;
    if (!validEvent) return Response.json({ error: "SEC 事件简析无效。" }, { status: 400 });
    if (!isTrackedTicker(eventTicker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
    await repository.setSummary({ ...body.summary, ticker: eventTicker, accessionNumber: eventAccession });
    return Response.json({ status: "published", ticker: eventTicker, accessionNumber: eventAccession }, { headers: { "cache-control": "no-store" } });
  }
  const artifact = body?.artifact;
  const ticker = cleanSecTicker(artifact?.filing?.ticker ?? "");
  if (!artifact || !artifact.filing.accessionNumber || !ticker) return Response.json({ error: "SEC 分析结果无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  const normalizedArtifact = { ...artifact, filing: { ...artifact.filing, ticker } };
  await repository.saveAnalysis(normalizedArtifact, false);
  if (artifact.report.dataQuality.verificationStatus === "failed") {
    return Response.json({ status: "rejected", ticker, accessionNumber: artifact.filing.accessionNumber }, { headers: { "cache-control": "no-store" } });
  }
  if (!body?.summary) return Response.json({ error: "SEC 最终发布缺少报告摘要。" }, { status: 400 });
  const memoryJobId = await repository.commitFinalPublication(normalizedArtifact, body.summary);
  return Response.json({ status: "published", ticker, accessionNumber: artifact.filing.accessionNumber, memoryJobId }, { headers: { "cache-control": "no-store" } });
}
