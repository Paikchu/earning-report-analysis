import { cleanSecAccession, type SecFilingWithSummary } from "./sec.ts";
import { decodePageCursor, encodePageCursor, normalizeTrackedTicker } from "./sec-config.ts";
import { D1SecRepository } from "./sec-d1.ts";
import { getCachedSecFeed } from "./sec-feed.ts";
import { findSecurity } from "./site-data.ts";

export type PublicAnalysisStatus = "complete" | "partial" | "processing" | "not_collected";

export type PublicSecFiling = {
  accessionNumber: string;
  ticker: string;
  companyName: string;
  form: string;
  filingDate: string;
  reportDate: string;
  description: string;
  summary: SecFilingWithSummary["summary"];
  analysis: SecFilingWithSummary["analysis"];
  analysisStatus: PublicAnalysisStatus;
  reportVersion: string | null;
  edgarUrl: string;
  documentUrl: string;
};

export type PublicFilingPage = {
  ticker: string;
  company: { ticker: string; name: string; cik: string } | null;
  filings: PublicSecFiling[];
  nextCursor: string | null;
  total: number;
  checkedAt: string | null;
};

export async function getPublicFilingPage(
  repository: D1SecRepository,
  rawTicker: string,
  rawCursor: string | null,
  rawLimit: string | null,
): Promise<PublicFilingPage> {
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) throw new Error("Invalid ticker");
  if (rawCursor && !decodePageCursor(rawCursor)) throw new Error("Invalid cursor");
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(rawLimit ?? 20)) || 20));
  const cursor = decodePageCursor(rawCursor);
  // 缓存只保留最近一轮抓取的滚动窗口，历史申报必须与 D1 累积表合并分页。
  const storedPageRequest = repository.listPublicFilings(ticker, rawCursor, limit);
  const [cachedFeed, storedPage] = await Promise.all([
    typeof repository.getCache === "function" ? getCachedSecFeed(repository, ticker) : null,
    // 归档表读失败时不能连带打掉缓存本来就能提供的那一页，降级成缓存窗口即可。
    storedPageRequest.catch(() => null),
  ]);
  // 但没有缓存兜底时错误必须冒出去，否则一张坏掉的 sec_filings 会伪装成"暂未收录"。
  // getCachedSecFeed 在缓存缺失时返回的是 pending 空 feed 而不是 null，所以这里看的是有没有申报可发。
  if (!storedPage && !cachedFeed?.filings.length) await storedPageRequest;
  const afterCursor = (filing: SecFilingWithSummary) => !cursor
    || filing.filingDate < cursor.filingDate
    || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber);
  const merged = new Map<string, SecFilingWithSummary>();
  for (const filing of cachedFeed?.filings ?? []) {
    if (afterCursor(filing)) merged.set(filing.accessionNumber, filing);
  }
  for (const filing of storedPage?.filings ?? []) {
    if (!merged.has(filing.accessionNumber)) merged.set(filing.accessionNumber, filing);
  }
  const candidates = [...merged.values()].sort((left, right) =>
    right.filingDate.localeCompare(left.filingDate)
    || right.accessionNumber.localeCompare(left.accessionNumber));
  const pageFilings = candidates.slice(0, limit);
  const last = pageFilings.at(-1);
  const hasMore = candidates.length > limit || Boolean(storedPage?.nextCursor);
  const company = cachedFeed?.company ?? (pageFilings[0] ? companyFromFiling(pageFilings[0]) : companyFromDirectory(ticker));
  const filings = await Promise.all(pageFilings.map(async (filing) => toPublicFiling(repository, filing, company?.name ?? ticker)));
  return {
    ticker,
    company,
    filings,
    nextCursor: hasMore && last ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber }) : null,
    // 缓存可能比 D1 领先一轮抓取，取两者较大值才不会少报历史条数。
    total: Math.max(storedPage?.total ?? 0, cachedFeed?.filings.length ?? 0),
    checkedAt: cachedFeed?.fetchedAt ?? null,
  };
}

export async function getPublicFiling(
  repository: D1SecRepository,
  rawTicker: string,
  rawAccession: string,
): Promise<{ ticker: string; company: { ticker: string; name: string; cik: string } | null; filing: PublicSecFiling } | null> {
  const ticker = normalizeTrackedTicker(rawTicker);
  const accession = cleanSecAccession(rawAccession);
  if (!ticker || !accession) return null;
  const cachedFeed = typeof repository.getCache === "function" ? await getCachedSecFeed(repository, ticker) : null;
  const filing = cachedFeed?.filings.find((candidate) => candidate.accessionNumber === accession) ?? await repository.getPublicFiling(ticker, accession);
  if (!filing) return null;
  const company = cachedFeed?.company ?? companyFromFiling(filing) ?? companyFromDirectory(ticker);
  return {
    ticker,
    company,
    filing: await toPublicFiling(repository, filing, company?.name ?? ticker),
  };
}

async function toPublicFiling(repository: D1SecRepository, filing: SecFilingWithSummary, companyName: string): Promise<PublicSecFiling> {
  const jobStatus = await repository.getLatestAnalysisJobStatus(filing.ticker, filing.accessionNumber);
  const report = filing.analysis;
  const analysisStatus: PublicAnalysisStatus = report
    ? report.dataQuality.verificationStatus === "verified" ? "complete" : "partial"
    : jobStatus === "queued" || jobStatus === "running" ? "processing" : "not_collected";
  return {
    accessionNumber: filing.accessionNumber,
    ticker: filing.ticker,
    companyName,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    description: filing.description,
    summary: filing.summary,
    analysis: report,
    analysisStatus,
    reportVersion: report?.reportVersion ?? null,
    edgarUrl: filing.indexUrl,
    documentUrl: filing.documentUrl,
  };
}

function companyFromFiling(filing: SecFilingWithSummary): { ticker: string; name: string; cik: string } | null {
  if (!filing.companyName || filing.companyName === filing.ticker) return null;
  return { ticker: filing.ticker, name: filing.companyName, cik: filing.cik };
}

function companyFromDirectory(ticker: string): { ticker: string; name: string; cik: string } | null {
  const security = findSecurity(ticker);
  return security ? { ticker: security.symbol, name: security.name, cik: "" } : null;
}
