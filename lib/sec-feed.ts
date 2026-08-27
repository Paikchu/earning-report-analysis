import { cleanSecTicker, sortSecFilings, type SecFiling, type SecFilingFeed } from "./sec.ts";
import { buildPeriodIdentity } from "./sec-analysis.ts";
import type { SecRepository } from "./sec-types.ts";

type StoredSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: SecFiling[];
};

export function secFilingCacheKey(ticker: string): string {
  return `sec:filings:${ticker}`;
}

export async function getCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await repository.getCache<StoredSecFeed>(secFilingCacheKey(ticker));
  if (!cached) return { ticker, company: null, filings: [], fetchedAt: null, status: "pending" };
  const filings: SecFilingFeed["filings"] = [];
  const structuredPeriods = new Set<string>();
  for (const filing of sortSecFilings(cached.payload.filings)) {
    const periodId = buildPeriodIdentity(ticker, filing.form, filing.reportDate).periodId;
    const periodic = /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form);
    const attachStructuredReport = periodic && !structuredPeriods.has(periodId);
    if (periodic) structuredPeriods.add(periodId);
    filings.push({
      ...filing,
      summary: await repository.getSummary(ticker, filing.accessionNumber),
      analysis: attachStructuredReport && repository.getPublishedReport
        ? await repository.getPublishedReport(ticker, periodId).catch(() => null)
        : null,
    });
  }
  return { ...cached.payload, filings };
}
