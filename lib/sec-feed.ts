import { cleanSecTicker, sortSecFilings, type SecFiling, type SecFilingFeed } from "./sec.ts";
import { buildPeriodIdentity } from "./sec-analysis.ts";
import type { SecRepository } from "./sec-types.ts";

type StoredSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: SecFiling[];
};

export function secFilingCacheKey(ticker: string): string {
  return `sec:filings:${ticker}`;
}

const PERIODIC_SEC_FORM = /^(10-Q|10-K|20-F)(\/A)?$/;

/**
 * 同一报告期只让最新的一份定期报告挂载已发布研报，修订件和事件类申报都不挂，
 * 否则一篇研报会在时间线上重复出现。
 *
 * 读取侧有两条 hydrate 路径（缓存 feed 与 D1 归档表），公开接口会把两者合并成一页，
 * 所以这条规则必须共用一份实现，不能各写各的。返回应当挂载的 periodId，不该挂载时返回 null。
 */
export function createPeriodReportGate(ticker: string) {
  const claimed = new Set<string>();
  return (filing: Pick<SecFiling, "form" | "reportDate">): string | null => {
    if (!PERIODIC_SEC_FORM.test(filing.form)) return null;
    const { periodId } = buildPeriodIdentity(ticker, filing.form, filing.reportDate);
    if (claimed.has(periodId)) return null;
    claimed.add(periodId);
    return periodId;
  };
}

export async function getCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await repository.getCache<StoredSecFeed>(secFilingCacheKey(ticker));
  if (!cached) return { ticker, company: null, filings: [], fetchedAt: null, status: "pending" };
  const filings: SecFilingFeed["filings"] = [];
  const claimPeriodReport = createPeriodReportGate(ticker);
  for (const filing of sortSecFilings(cached.payload.filings)) {
    const periodId = claimPeriodReport(filing);
    filings.push({
      ...filing,
      summary: await repository.getSummary(ticker, filing.accessionNumber),
      analysis: periodId && repository.getPublishedReport
        ? await repository.getPublishedReport(ticker, periodId).catch(() => null)
        : null,
    });
  }
  return { ...cached.payload, filings };
}
