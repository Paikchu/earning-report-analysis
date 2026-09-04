import { cleanSecTicker, sortSecFilings, type SecFiling, type SecFilingFeed, type SecFilingWithSummary } from "./sec.ts";
import { buildPeriodIdentity } from "./sec-analysis.ts";
import type { SecRepository } from "./sec-types.ts";

type StoredSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: SecFiling[];
};

/** A cached filing plus the period whose structured report it carries, if it carries one. */
export type CachedSecFiling = SecFiling & { structuredPeriodId: string | null };

export type CachedSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: CachedSecFiling[];
};

export function secFilingCacheKey(ticker: string): string {
  return `sec:filings:${ticker}`;
}

/**
 * Reads the cache window without touching per-filing storage. Hydration is what costs — one summary
 * read per filing, plus a report read for the periodic ones — so callers that render a single page
 * read the window here and hydrate only the slice they return.
 */
export async function readCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<CachedSecFeed | null> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await repository.getCache<StoredSecFeed>(secFilingCacheKey(ticker));
  if (!cached) return null;
  // Which filing owns a period's structured report depends on the whole window, not on the page, so
  // it is resolved here while every filing is still in hand.
  const structuredPeriods = new Set<string>();
  const filings = sortSecFilings(cached.payload.filings).map((filing) => {
    const periodId = buildPeriodIdentity(ticker, filing.form, filing.reportDate).periodId;
    const periodic = /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form);
    const structuredPeriodId = periodic && !structuredPeriods.has(periodId) ? periodId : null;
    if (periodic) structuredPeriods.add(periodId);
    return { ...filing, structuredPeriodId };
  });
  return { ...cached.payload, filings };
}

export async function hydrateCachedFilings(
  repository: SecRepository,
  ticker: string,
  filings: CachedSecFiling[],
): Promise<SecFilingWithSummary[]> {
  return Promise.all(filings.map(async ({ structuredPeriodId, ...filing }) => ({
    ...filing,
    summary: await repository.getSummary(ticker, filing.accessionNumber),
    analysis: structuredPeriodId && repository.getPublishedReport
      ? await repository.getPublishedReport(ticker, structuredPeriodId).catch(() => null)
      : null,
  })));
}

export async function getCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await readCachedSecFeed(repository, ticker);
  if (!cached) return { ticker, company: null, filings: [], fetchedAt: null, status: "pending" };
  return { ...cached, filings: await hydrateCachedFilings(repository, ticker, cached.filings) };
}
