export type OwnershipStatus = "ready" | "pending" | "not_applicable" | "stale" | "unavailable";

export type OwnershipFeed = {
  ticker: string;
  institutionalPct: number | null;
  insiderMajorHolderPctEstimate: number | null;
  retailUnclassifiedPct: number | null;
  dataAsOf: string | null;
  disclosureDueDate: string | null;
  fetchedAt: string | null;
  status: OwnershipStatus;
  error?: string;
};

export type OwnershipCacheRecord<T> = {
  payload: T;
  fetchedAt: string;
};

export type OwnershipRepository = {
  getCache<T>(key: string): Promise<OwnershipCacheRecord<T> | null>;
  setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void>;
};

export type OwnershipRuntime = {
  fetcher?: typeof fetch;
  now?: () => Date;
};

type NasdaqOwnershipPayload = {
  data?: {
    ownershipSummary?: {
      SharesOutstandingPCT?: { value?: unknown };
      ShareoutstandingTotal?: { value?: unknown };
    };
    holdingsTransactions?: { table?: { rows?: unknown[] } };
  };
};

type NasdaqInsiderPayload = {
  data?: { transactionTable?: { table?: { rows?: unknown[] } } };
};

type StoredOwnershipFeed = OwnershipFeed;

const NASDAQ_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/",
  "user-agent": "Mozilla/5.0",
};

export function ownershipCacheKey(rawTicker: string): string {
  return `ownership:${cleanTicker(rawTicker)}`;
}

export async function getCachedOwnership(repository: OwnershipRepository, rawTicker: string): Promise<OwnershipFeed> {
  const ticker = cleanTicker(rawTicker);
  const cached = await repository.getCache<StoredOwnershipFeed>(ownershipCacheKey(ticker));
  if (!cached) return emptyOwnershipFeed(ticker, "pending");
  return { ...cached.payload, fetchedAt: cached.fetchedAt };
}

export async function refreshOwnership(
  repository: OwnershipRepository,
  rawTicker: string,
  runtime: OwnershipRuntime = {},
): Promise<OwnershipFeed> {
  const ticker = cleanTicker(rawTicker);
  const now = (runtime.now ?? (() => new Date()))();
  const fetcher = runtime.fetcher ?? fetch;

  try {
    const [institutionalResponse, insiderResponse] = await Promise.all([
      fetcher(`https://api.nasdaq.com/api/company/${encodeURIComponent(ticker)}/institutional-holdings?limit=15&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`, {
        cache: "no-store",
        headers: NASDAQ_HEADERS,
        signal: AbortSignal.timeout(10_000),
      }),
      fetcher(`https://api.nasdaq.com/api/company/${encodeURIComponent(ticker)}/insider-trades?limit=5000`, {
        cache: "no-store",
        headers: NASDAQ_HEADERS,
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!institutionalResponse.ok) throw new Error(`Institutional holdings HTTP ${institutionalResponse.status}`);
    if (!insiderResponse.ok) throw new Error(`Insider holdings HTTP ${insiderResponse.status}`);

    const feed = parseOwnershipPayloads(ticker, await institutionalResponse.json(), await insiderResponse.json(), now);
    await repository.setCache(ownershipCacheKey(ticker), feed, now.toISOString());
    return feed;
  } catch {
    const previous = await getCachedOwnership(repository, ticker);
    if (previous.status !== "pending") {
      return {
        ...previous,
        status: "stale",
        error: "持仓结构暂时无法更新，当前显示上次成功结果。",
      };
    }
    return {
      ...previous,
      status: "unavailable",
      fetchedAt: now.toISOString(),
      error: "持仓结构暂时无法读取。",
    };
  }
}

export function parseOwnershipPayloads(
  rawTicker: string,
  institutionalPayload: unknown,
  insiderPayload: unknown,
  now = new Date(),
): OwnershipFeed {
  const ticker = cleanTicker(rawTicker);
  const institutional = institutionalPayload as NasdaqOwnershipPayload;
  const insiders = insiderPayload as NasdaqInsiderPayload;
  const summary = institutional.data?.ownershipSummary;
  const institutionalPct = parseNumber(summary?.SharesOutstandingPCT?.value);
  const sharesOutstanding = parseNumber(summary?.ShareoutstandingTotal?.value);
  const dataAsOf = latestInstitutionalDate(institutional.data?.holdingsTransactions?.table?.rows ?? []);
  const insiderShares = latestDisclosedInsiderShares(insiders.data?.transactionTable?.table?.rows ?? []);
  const insiderMajorHolderPctEstimate = sharesOutstanding && insiderShares !== null
    ? clamp(insiderShares / (sharesOutstanding * 1_000_000) * 100)
    : null;
  const retailUnclassifiedPct = institutionalPct !== null && insiderMajorHolderPctEstimate !== null
    ? clamp(100 - institutionalPct - insiderMajorHolderPctEstimate)
    : null;

  return {
    ticker,
    institutionalPct: institutionalPct === null ? null : clamp(institutionalPct),
    insiderMajorHolderPctEstimate,
    retailUnclassifiedPct,
    dataAsOf,
    disclosureDueDate: dataAsOf ? addDaysToQuarterEnd(dataAsOf, 45) : null,
    fetchedAt: now.toISOString(),
    status: "ready",
  };
}

function emptyOwnershipFeed(ticker: string, status: OwnershipStatus): OwnershipFeed {
  return {
    ticker,
    institutionalPct: null,
    insiderMajorHolderPctEstimate: null,
    retailUnclassifiedPct: null,
    dataAsOf: null,
    disclosureDueDate: null,
    fetchedAt: null,
    status,
  };
}

function latestInstitutionalDate(rows: unknown[]): string | null {
  const dates = rows.flatMap((row) => {
    const value = asRecord(row)?.date;
    const date = parseNasdaqDate(value);
    return date ? [date] : [];
  });
  return dates.sort().at(-1) ?? null;
}

function latestDisclosedInsiderShares(rows: unknown[]): number | null {
  const latest = new Map<string, { date: string; shares: number }>();
  for (const row of rows) {
    const record = asRecord(row);
    const insider = String(record?.insider ?? "").trim();
    const ownType = String(record?.ownType ?? "").trim() || "Unknown";
    const date = parseNasdaqDate(record?.lastDate);
    const shares = parseNumber(record?.sharesHeld);
    if (!insider || !date || shares === null) continue;
    const key = `${insider}:${ownType}`;
    const current = latest.get(key);
    if (!current || date > current.date || (date === current.date && shares > current.shares)) {
      latest.set(key, { date, shares: Math.max(0, shares) });
    }
  }
  if (!latest.size) return null;
  return [...latest.values()].reduce((total, entry) => total + entry.shares, 0);
}

function parseNasdaqDate(value: unknown): string | null {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function addDaysToQuarterEnd(dataAsOf: string, days: number): string {
  const date = new Date(`${dataAsOf}T00:00:00Z`);
  const quarterEnd = new Date(Date.UTC(date.getUTCFullYear(), Math.ceil((date.getUTCMonth() + 1) / 3) * 3, 0));
  quarterEnd.setUTCDate(quarterEnd.getUTCDate() + days);
  return quarterEnd.toISOString().slice(0, 10);
}

function parseNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/[,$%]/g, "").trim();
  if (!text || text === "—" || text === "-") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function cleanTicker(value: string): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
