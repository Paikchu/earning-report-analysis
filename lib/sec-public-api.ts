import { cleanSecAccession, type SecFiling, type SecFilingWithSummary } from "./sec.ts";
import { decodePageCursor, encodePageCursor, normalizeTrackedTicker } from "./sec-config.ts";
import { D1SecRepository } from "./sec-d1.ts";
import { hydrateCachedFilings, readCachedSecFeed } from "./sec-feed.ts";
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
  /** Counted on the first page only; a later page reports null and the client keeps what it has. */
  total: number | null;
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
  const cachedFeed = typeof repository.getCache === "function" ? await readCachedSecFeed(repository, ticker) : null;
  // The cache only holds the newest window. A cursor older than its last filing selects nothing here,
  // so a deep page never pays to hydrate a window it cannot use.
  const cachedFilings = cachedFeed?.filings
    .filter((filing) => isBeforeCursor(filing, cursor))
    .sort(byCursorOrder) ?? [];
  const cachedPage = cachedFilings.slice(0, limit);
  const total = cursor ? null : await repository.countPublicFilings(ticker);
  const last = cachedPage.at(-1);
  // The cache answers a page only when it can also say what follows it: either it still holds older
  // filings, or the count says there are none. Otherwise D1 — which keeps the whole history — does,
  // so the cursor chain runs past the window instead of ending at it.
  const cacheAnswersPage = cachedFilings.length > limit || (total !== null && total <= cachedPage.length);
  const page = last && cacheAnswersPage
    ? {
      filings: await hydrateCachedFilings(repository, ticker, cachedPage),
      nextCursor: cachedFilings.length > limit
        ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber })
        : null,
    }
    : await repository.listPublicFilings(ticker, rawCursor, limit);
  const company = cachedFeed?.company ?? (page.filings[0] ? companyFromFiling(page.filings[0]) : companyFromDirectory(ticker));
  const filings = await Promise.all(page.filings.map(async (filing) => toPublicFiling(repository, filing, company?.name ?? ticker)));
  return { ticker, company, filings, nextCursor: page.nextCursor, total, checkedAt: cachedFeed?.fetchedAt ?? null };
}

export async function getPublicFiling(
  repository: D1SecRepository,
  rawTicker: string,
  rawAccession: string,
): Promise<{ ticker: string; company: { ticker: string; name: string; cik: string } | null; filing: PublicSecFiling } | null> {
  const ticker = normalizeTrackedTicker(rawTicker);
  const accession = cleanSecAccession(rawAccession);
  if (!ticker || !accession) return null;
  const cachedFeed = typeof repository.getCache === "function" ? await readCachedSecFeed(repository, ticker) : null;
  const cached = cachedFeed?.filings.find((candidate) => candidate.accessionNumber === accession);
  const filing = cached
    ? (await hydrateCachedFilings(repository, ticker, [cached]))[0]!
    : await repository.getPublicFiling(ticker, accession);
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

function isBeforeCursor(filing: SecFiling, cursor: { filingDate: string; accessionNumber: string } | null): boolean {
  if (!cursor) return true;
  return filing.filingDate < cursor.filingDate
    || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber);
}

/**
 * The order the cursor reads. `sortSecFilings` keeps SEC's own order inside a filing date, but the
 * cursor breaks a same-date tie on the accession number and D1 orders by it, so a page served from
 * the cache has to agree — otherwise the two sources disagree about what follows a given filing and
 * same-day filings fall through the gap between pages.
 */
function byCursorOrder(left: SecFiling, right: SecFiling): number {
  return right.filingDate.localeCompare(left.filingDate)
    || right.accessionNumber.localeCompare(left.accessionNumber);
}

function companyFromFiling(filing: SecFilingWithSummary): { ticker: string; name: string; cik: string } | null {
  if (!filing.companyName || filing.companyName === filing.ticker) return null;
  return { ticker: filing.ticker, name: filing.companyName, cik: filing.cik };
}

function companyFromDirectory(ticker: string): { ticker: string; name: string; cik: string } | null {
  const security = findSecurity(ticker);
  return security ? { ticker: security.symbol, name: security.name, cik: "" } : null;
}
