import type { AnalysisDataEnv } from "./types.ts";
import { parseTrackedTickers } from "../sec/config.ts";
import { D1SecRepository } from "../sec/d1.ts";
import { cleanSecTicker, type SecFiling, type SecFilingFeed } from "../sec/sec.ts";
import { isTrackedTicker } from "../sec/config.ts";

export async function storeSecFeed(input: unknown, env: AnalysisDataEnv) {
  const runtime = { trackedTickers: parseTrackedTickers(env.SEC_TRACKED_TICKERS) };
  const body = input as { feed?: SecFilingFeed } | null;
  const ticker = cleanSecTicker(body?.feed?.ticker ?? "");
  if (!body?.feed || !ticker) return Response.json({ error: "SEC 索引数据无效。" }, { status: 400 });
  if (!isTrackedTicker(ticker, runtime.trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  const feed = {
    ...body.feed,
    ticker,
    filings: body.feed.filings.map(toStoredFiling),
  };
  const repository = new D1SecRepository(env.DB);
  await repository.setCache(`sec:filings:${ticker}`, feed, body.feed.fetchedAt ?? new Date().toISOString());
  await Promise.all(feed.filings.map((filing) => repository.upsertFilingIndex(filing)));
  return Response.json({ status: "stored", ticker, count: feed.filings.length }, { headers: { "cache-control": "no-store" } });
}

function toStoredFiling(filing: SecFilingFeed["filings"][number]): SecFiling {
  return {
    ticker: filing.ticker,
    cik: filing.cik,
    cikNumber: filing.cikNumber,
    companyName: filing.companyName,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    primaryDocument: filing.primaryDocument,
    description: filing.description,
    items: filing.items,
    documentUrl: filing.documentUrl,
    indexUrl: filing.indexUrl,
  };
}
