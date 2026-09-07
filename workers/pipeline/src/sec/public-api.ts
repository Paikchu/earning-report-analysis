import type { PublicAnalysisStatus, PublicSecFiling, PublicFilingPage } from "../../../../shared/analysis-contract/filings.ts";
export type { PublicAnalysisStatus, PublicSecFiling, PublicFilingPage } from "../../../../shared/analysis-contract/filings.ts";
import { cleanSecAccession, type SecFilingWithSummary } from "./sec.ts";
import { decodePageCursor, encodePageCursor, normalizeTrackedTicker } from "./config.ts";
import { D1SecRepository } from "./d1.ts";
import { getCachedSecFeed } from "./feed.ts";








export async function getPublicFilingPage(
  repository: D1SecRepository,
  rawTicker: string,
  rawCursor: string | null,
  rawLimit: string | null,
): Promise<PublicFilingPage> {
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) throw new Error("Invalid ticker");
  if (rawCursor && !decodePageCursor(rawCursor)) throw new Error("Invalid cursor");
  const cachedFeed = typeof repository.getCache === "function" ? await getCachedSecFeed(repository, ticker) : null;
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(rawLimit ?? 20)) || 20));
  const cursor = decodePageCursor(rawCursor);
  const cachedFilings = cachedFeed?.filings.filter((filing) => !cursor || filing.filingDate < cursor.filingDate || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber)) ?? [];
  const cachedPage = cachedFilings.slice(0, limit);
  const page = cachedPage.length > 0 || cachedFeed
    ? { filings: cachedPage, total: cachedFeed?.filings.length ?? 0, nextCursor: cachedFilings.length > limit ? encodePageCursor({ filingDate: cachedPage.at(-1)!.filingDate, accessionNumber: cachedPage.at(-1)!.accessionNumber }) : null }
    : await repository.listPublicFilings(ticker, rawCursor, limit);
  const company = cachedFeed?.company ?? (page.filings[0] ? companyFromFiling(page.filings[0]) : companyFromDirectory(ticker));
  const filings = await Promise.all(page.filings.map(async (filing) => toPublicFiling(repository, filing, company?.name ?? ticker)));
  return { ticker, company, filings, nextCursor: page.nextCursor, total: page.total, checkedAt: cachedFeed?.fetchedAt ?? null };
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
    summary: publicSummary(filing.summary),
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
  return { ticker, name: ticker, cik: "" };
}

function publicSummary(summary: SecFilingWithSummary["summary"]): PublicSecFiling["summary"] {
  if (!summary) return null;
  return {
    ticker: summary.ticker, form: summary.form, filingDate: summary.filingDate,
    accessionNumber: summary.accessionNumber, headline: summary.headline,
    bullets: summary.bullets, analystView: summary.analystView, eventCategory: summary.eventCategory,
    report: summary.report, version: summary.version, nodes: summary.nodes,
    repairRounds: summary.repairRounds, source: summary.source,
    generatedAt: summary.generatedAt, error: summary.error,
  };
}
