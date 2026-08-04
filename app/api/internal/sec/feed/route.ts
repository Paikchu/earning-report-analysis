import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecTicker, type SecFiling, type SecFilingFeed } from "@/lib/sec";
import { findSecurity } from "@/lib/site-data";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权写入 SEC 索引。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { feed?: SecFilingFeed } | null;
  const ticker = cleanSecTicker(body?.feed?.ticker ?? "");
  const security = findSecurity(ticker);
  if (!body?.feed || !security || security.type !== "stock") return Response.json({ error: "SEC 索引数据无效。" }, { status: 400 });
  const feed = {
    ...body.feed,
    ticker,
    filings: body.feed.filings.map(toStoredFiling),
  };
  await new D1SecRepository(await getD1()).setCache(`sec:filings:${ticker}`, feed, body.feed.fetchedAt ?? new Date().toISOString());
  return Response.json({ status: "stored", ticker }, { headers: { "cache-control": "no-store" } });
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
