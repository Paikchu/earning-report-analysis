import { cleanSecAccession, type SecFiling, type SecFilingWithSummary } from "./sec.ts";
import { decodePageCursor, encodePageCursor, normalizeTrackedTicker } from "./sec-config.ts";
import { D1SecRepository } from "./sec-d1.ts";
import { hydrateCachedFilings, readCachedSecFeed } from "./sec-feed.ts";
import { findSecurity } from "./site-data.ts";
import { AnalysisRequestError } from "./analysis-contract/errors.ts";
import {
  ANALYSIS_FILING_PAGE_DEFAULT_LIMIT,
  ANALYSIS_FILING_PAGE_MAX_LIMIT,
  type AnalysisRunSummary,
  type PublicAnalysisStatus,
  type PublicFilingCompany,
  type PublicFilingDetail,
  type PublicFilingPage,
  type PublicSecFiling,
} from "./analysis-contract/filings.ts";
import { ANALYSIS_API_SCHEMA_VERSION, splitReportVersion } from "./analysis-contract/versions.ts";

/**
 * The filing read queries. This module reaches storage, so it belongs to the analysis backend and
 * nothing in the Web Worker may import it — the wire types it used to define now live in
 * `lib/analysis-contract/filings.ts` and are re-exported here so existing importers keep resolving.
 */
export type {
  AnalysisRunSummary,
  PublicAnalysisStatus,
  PublicFilingCompany,
  PublicFilingDetail,
  PublicFilingPage,
  PublicSecFiling,
};

export async function getPublicFilingPage(
  repository: D1SecRepository,
  rawTicker: string,
  rawCursor: string | null,
  rawLimit: string | null,
): Promise<PublicFilingPage> {
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) throw new AnalysisRequestError("INVALID_TICKER", "Ticker is invalid.");
  if (rawCursor && !decodePageCursor(rawCursor)) throw new AnalysisRequestError("INVALID_CURSOR", "Cursor is invalid.");
  const limit = parseFilingLimit(rawLimit);
  const cursor = decodePageCursor(rawCursor);
  const cachedFeed = typeof repository.getCache === "function" ? await readCachedSecFeed(repository, ticker) : null;
  // The cache only holds the newest window. A cursor older than its last filing selects nothing here,
  // so a deep page never pays to hydrate a window it cannot use.
  const cachedFilings = cachedFeed?.filings.filter((filing) => isBeforeCursor(filing, cursor)) ?? [];
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
  return {
    apiSchemaVersion: ANALYSIS_API_SCHEMA_VERSION,
    ticker,
    company,
    filings,
    nextCursor: page.nextCursor,
    total,
    checkedAt: cachedFeed?.fetchedAt ?? null,
  };
}

/**
 * A limit is a bound, not a suggestion. Anything unparseable falls back to the default rather than
 * rejecting, which is what this endpoint has always done; anything out of range is clamped, so no
 * caller can widen the page beyond what the backend is willing to serve.
 */
function parseFilingLimit(rawLimit: string | null): number {
  const parsed = Math.trunc(Number(rawLimit ?? ANALYSIS_FILING_PAGE_DEFAULT_LIMIT));
  const requested = Number.isFinite(parsed) && parsed !== 0 ? parsed : ANALYSIS_FILING_PAGE_DEFAULT_LIMIT;
  return Math.min(ANALYSIS_FILING_PAGE_MAX_LIMIT, Math.max(1, requested));
}

export async function getPublicFiling(
  repository: D1SecRepository,
  rawTicker: string,
  rawAccession: string,
): Promise<PublicFilingDetail | null> {
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
    apiSchemaVersion: ANALYSIS_API_SCHEMA_VERSION,
    ticker,
    company,
    filing: await toPublicFiling(repository, filing, company?.name ?? ticker),
  };
}

async function toPublicFiling(repository: D1SecRepository, filing: SecFilingWithSummary, companyName: string): Promise<PublicSecFiling> {
  const job = await readJobSummary(repository, filing.ticker, filing.accessionNumber);
  const report = filing.analysis;
  /**
   * Unchanged mapping — existing readers branch on these four values. It describes the *published
   * report*: a report that exists is complete or partial according to its own verification status,
   * and one that does not is `processing` while a run is in flight, `not_collected` otherwise.
   * `not_collected` covering a failed run is exactly why `analysisRun` below exists; the failure is
   * reported there rather than by quietly redefining this field.
   */
  const analysisStatus: PublicAnalysisStatus = report
    ? report.dataQuality.verificationStatus === "verified" ? "complete" : "partial"
    : job?.status === "queued" || job?.status === "running" ? "processing" : "not_collected";
  const { analysisSchemaVersion, contentRevision } = splitReportVersion(report?.reportVersion ?? null);
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
    provenance: "sec_edgar",
    // The report carries the period it was written for. A summary-only filing — an 8-K, say — has
    // no structured report and therefore no report period; that is a real null, not a gap.
    periodId: report?.periodId ?? null,
    analysisSchemaVersion,
    contentRevision,
    analysisRun: toRunSummary(job),
  };
}

type JobSummary = { status: "queued" | "running" | "complete" | "failed" | null; updatedAt: string | null; errorCode: string | null };

/**
 * Job history is metadata about the run, not the result. A repository that cannot answer reports
 * `unknown` rather than taking a readable filing down with it — but the filing itself, and its
 * published report, still propagate their failures.
 */
async function readJobSummary(repository: D1SecRepository, ticker: string, accessionNumber: string): Promise<JobSummary | null> {
  try {
    return await repository.getLatestAnalysisJobSummary(ticker, accessionNumber);
  } catch {
    return null;
  }
}

function toRunSummary(job: JobSummary | null): AnalysisRunSummary {
  if (!job) return { state: "unknown", updatedAt: null, errorCode: null };
  if (!job.status) return { state: "none", updatedAt: null, errorCode: null };
  const state = job.status === "complete" ? "succeeded" : job.status === "failed" ? "failed" : job.status;
  return { state, updatedAt: job.updatedAt, errorCode: job.errorCode };
}

function isBeforeCursor(filing: SecFiling, cursor: { filingDate: string; accessionNumber: string } | null): boolean {
  if (!cursor) return true;
  return filing.filingDate < cursor.filingDate
    || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber);
}

function companyFromFiling(filing: SecFilingWithSummary): PublicFilingCompany | null {
  if (!filing.companyName || filing.companyName === filing.ticker) return null;
  return { ticker: filing.ticker, name: filing.companyName, cik: filing.cik };
}

function companyFromDirectory(ticker: string): PublicFilingCompany | null {
  const security = findSecurity(ticker);
  return security ? { ticker: security.symbol, name: security.name, cik: "" } : null;
}
