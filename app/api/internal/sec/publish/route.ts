import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecAccession, cleanSecTicker, type SecFiling, type SecFilingSummary } from "@/lib/sec";
import type { FilingBlock } from "@/lib/sec-analysis";
import type { SecAnalysisArtifact } from "@/lib/sec-types";
import { isTrackedTicker } from "@/lib/sec-config";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权发布 SEC 分析。" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    artifact?: SecAnalysisArtifact;
    filing?: SecFiling;
    blocks?: FilingBlock[];
    summary?: SecFilingSummary | null;
  } | null;
  const repository = new D1SecRepository(await getD1());
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
