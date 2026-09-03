import {
  FUNDAMENTAL_METRIC_CATALOG,
  FUNDAMENTAL_METRIC_CATALOG_VERSION,
  isFundamentalMetricKey,
  type FundamentalChartMark,
  type FundamentalDisplaySign,
  type FundamentalMetricCategory,
  type FundamentalMetricKey,
  type FundamentalTransform,
  type FundamentalUnitFamily,
} from "./fundamental-metrics.ts";
import type {
  FundamentalCurrentObservation,
  FundamentalLastGoodSnapshot,
  FundamentalsRepository,
} from "./fundamentals-d1.ts";
import { normalizeFundamentalTicker } from "./yahoo-fundamentals-schema.ts";

export const FUNDAMENTALS_API_SCHEMA_VERSION = "fundamentals-api.v1";
export const FUNDAMENTALS_DEFAULT_PERIOD_COUNT = 5;
export const FUNDAMENTALS_MIN_PERIOD_COUNT = 2;
export const FUNDAMENTALS_MAX_PERIOD_COUNT = 12;
export const FUNDAMENTALS_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export type FundamentalApiQuery = {
  ticker: string;
  metricKeys: FundamentalMetricKey[] | null;
  periodCount: number;
};

export type PublicFundamentalPeriod = {
  periodType: "3M";
  periodEnd: string;
  currency: string;
};

export type PublicFundamentalPoint = {
  periodEnd: string;
  valueDecimal: string | null;
  revision: number | null;
};

export type PublicFundamentalSeries = {
  metricKey: FundamentalMetricKey;
  label: string;
  shortLabel: string;
  category: FundamentalMetricCategory;
  unitFamily: FundamentalUnitFamily;
  unit: string;
  currency: string;
  basis: "reported" | "derived";
  displaySign: FundamentalDisplaySign;
  defaultMark: FundamentalChartMark;
  allowedTransforms: readonly FundamentalTransform[];
  available: boolean;
  points: PublicFundamentalPoint[];
};

export type PublicFundamentalsResponse = {
  schemaVersion: typeof FUNDAMENTALS_API_SCHEMA_VERSION;
  catalogVersion: typeof FUNDAMENTAL_METRIC_CATALOG_VERSION;
  source: "yahoo_finance";
  ticker: string;
  status: "ready" | "pending";
  dataVersion: string | null;
  fetchedAt: string | null;
  stale: boolean;
  partial: boolean;
  qualityStatus: "complete" | "partial" | null;
  issueCount: number;
  requestedPeriodCount: number;
  periods: PublicFundamentalPeriod[];
  series: PublicFundamentalSeries[];
  refresh: {
    recommended: boolean;
    scheduled: boolean;
  };
};

export type PublicFundamentalsHandlerDependencies = {
  getRepository(): Promise<FundamentalsRepository>;
  isRefreshEligible(ticker: string): boolean;
  scheduleRefresh(repository: FundamentalsRepository, ticker: string): Promise<boolean>;
  clock?: () => Date;
};

export class FundamentalApiQueryError extends Error {
  readonly code: "INVALID_TICKER" | "INVALID_METRICS" | "INVALID_PERIOD_COUNT";

  constructor(code: FundamentalApiQueryError["code"], message: string) {
    super(message);
    this.name = "FundamentalApiQueryError";
    this.code = code;
  }
}

export function parseFundamentalApiQuery(
  rawTicker: string,
  searchParams: URLSearchParams,
): FundamentalApiQuery {
  const ticker = normalizeFundamentalTicker(rawTicker);
  if (!ticker) {
    throw new FundamentalApiQueryError("INVALID_TICKER", "Ticker is invalid.");
  }

  const rawMetricQueries = searchParams.getAll("metrics");
  if (rawMetricQueries.length > 1) {
    throw new FundamentalApiQueryError("INVALID_METRICS", "Metrics must be supplied once.");
  }
  const metricKeys = rawMetricQueries.length === 0 ? null : parseMetricKeys(rawMetricQueries[0]!);

  const rawPeriodCounts = searchParams.getAll("periodCount");
  if (rawPeriodCounts.length > 1) {
    throw new FundamentalApiQueryError("INVALID_PERIOD_COUNT", "Period count must be supplied once.");
  }
  const periodCount = rawPeriodCounts.length === 0
    ? FUNDAMENTALS_DEFAULT_PERIOD_COUNT
    : parsePeriodCount(rawPeriodCounts[0]!);

  return { ticker, metricKeys, periodCount };
}

export async function getPublicFundamentals(
  repository: Pick<FundamentalsRepository, "getLastGoodSnapshot">,
  query: FundamentalApiQuery,
  now = new Date(),
): Promise<PublicFundamentalsResponse> {
  const snapshot = await repository.getLastGoodSnapshot(query.ticker);
  if (!snapshot) return pendingResponse(query);

  const quarterlyObservations = snapshot.observations.filter((observation) => observation.periodType === "3M");
  const selectedPeriodEnds = [...new Set(quarterlyObservations.map((observation) => observation.periodEnd))]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, query.periodCount)
    .sort();
  const selectedPeriodSet = new Set(selectedPeriodEnds);
  const selectedObservations = quarterlyObservations.filter((observation) =>
    selectedPeriodSet.has(observation.periodEnd));
  const metricKeys = query.metricKeys ?? availableMetricKeys(quarterlyObservations);
  const fetchedAt = parseTimestamp(snapshot.fetchedAt);
  const catalogOutdated = snapshot.catalogVersion !== FUNDAMENTAL_METRIC_CATALOG_VERSION;
  const stale = catalogOutdated || fetchedAt === null || now.getTime() - fetchedAt.getTime() >= FUNDAMENTALS_STALE_AFTER_MS;

  return {
    schemaVersion: FUNDAMENTALS_API_SCHEMA_VERSION,
    catalogVersion: FUNDAMENTAL_METRIC_CATALOG_VERSION,
    source: "yahoo_finance",
    ticker: query.ticker,
    status: "ready",
    dataVersion: await buildFundamentalDataVersion(snapshot),
    fetchedAt: snapshot.fetchedAt,
    stale,
    partial: snapshot.qualityStatus === "partial",
    qualityStatus: snapshot.qualityStatus,
    issueCount: snapshot.issueCount,
    requestedPeriodCount: query.periodCount,
    periods: selectedPeriodEnds.map((periodEnd) => ({
      periodType: "3M",
      periodEnd,
      currency: currencyForPeriod(selectedObservations, periodEnd),
    })),
    series: metricKeys.map((metricKey) => buildPublicSeries(metricKey, selectedPeriodEnds, selectedObservations)),
    refresh: { recommended: stale, scheduled: false },
  };
}

export async function handlePublicFundamentalsRequest(
  request: Request,
  rawTicker: string,
  dependencies: PublicFundamentalsHandlerDependencies,
): Promise<Response> {
  try {
    const query = parseFundamentalApiQuery(rawTicker, new URL(request.url).searchParams);
    const repository = await dependencies.getRepository();
    const payload = await getPublicFundamentals(repository, query, dependencies.clock?.() ?? new Date());
    const refreshEligible = dependencies.isRefreshEligible(query.ticker);
    if (payload.status === "pending" && !refreshEligible) {
      return jsonResponse(
        { error: "Fundamentals are unavailable for this ticker.", code: "FUNDAMENTALS_NOT_AVAILABLE" },
        404,
        "no-store",
      );
    }

    const scheduled = payload.refresh.recommended && refreshEligible
      ? await dependencies.scheduleRefresh(repository, query.ticker)
      : false;
    return jsonResponse(
      { ...payload, refresh: { ...payload.refresh, scheduled } },
      200,
      payload.status === "pending"
        ? "no-store"
        : "public, max-age=30, stale-while-revalidate=300",
    );
  } catch (error) {
    if (error instanceof FundamentalApiQueryError) {
      return jsonResponse({ error: error.message, code: error.code }, 400, "no-store");
    }
    return jsonResponse(
      { error: "Fundamentals query failed.", code: "FUNDAMENTALS_QUERY_FAILED" },
      500,
      "no-store",
    );
  }
}

async function buildFundamentalDataVersion(snapshot: FundamentalLastGoodSnapshot): Promise<string> {
  const canonical = snapshot.observations
    .map((observation) => [
      observation.periodType,
      observation.periodEnd,
      observation.metricKey,
      observation.valueDecimal,
      observation.unit,
      observation.currency,
      observation.revision,
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const value = JSON.stringify([
    FUNDAMENTALS_API_SCHEMA_VERSION,
    FUNDAMENTAL_METRIC_CATALOG_VERSION,
    snapshot.qualityStatus,
    snapshot.issueCount,
    canonical,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildPublicSeries(
  metricKey: FundamentalMetricKey,
  periodEnds: string[],
  observations: FundamentalCurrentObservation[],
): PublicFundamentalSeries {
  const definition = FUNDAMENTAL_METRIC_CATALOG[metricKey];
  const byPeriod = new Map(
    observations
      .filter((observation) => observation.metricKey === metricKey)
      .map((observation) => [observation.periodEnd, observation]),
  );
  const latest = [...periodEnds].reverse().map((periodEnd) => byPeriod.get(periodEnd)).find(Boolean);
  const unit = latest?.unit ?? defaultUnit(definition.unitFamily);
  const currency = latest?.currency ?? "";

  return {
    metricKey,
    label: definition.label,
    shortLabel: definition.shortLabel,
    category: definition.category,
    unitFamily: definition.unitFamily,
    unit,
    currency,
    basis: definition.basis,
    displaySign: definition.displaySign,
    defaultMark: definition.defaultMark,
    allowedTransforms: definition.allowedTransforms,
    available: byPeriod.size > 0,
    points: periodEnds.map((periodEnd) => {
      const observation = byPeriod.get(periodEnd);
      return {
        periodEnd,
        valueDecimal: observation?.valueDecimal ?? null,
        revision: observation?.revision ?? null,
      };
    }),
  };
}

function pendingResponse(query: FundamentalApiQuery): PublicFundamentalsResponse {
  return {
    schemaVersion: FUNDAMENTALS_API_SCHEMA_VERSION,
    catalogVersion: FUNDAMENTAL_METRIC_CATALOG_VERSION,
    source: "yahoo_finance",
    ticker: query.ticker,
    status: "pending",
    dataVersion: null,
    fetchedAt: null,
    stale: true,
    partial: false,
    qualityStatus: null,
    issueCount: 0,
    requestedPeriodCount: query.periodCount,
    periods: [],
    series: [],
    refresh: { recommended: true, scheduled: false },
  };
}

function availableMetricKeys(observations: FundamentalCurrentObservation[]): FundamentalMetricKey[] {
  const available = new Set(observations.map((observation) => observation.metricKey));
  return (Object.keys(FUNDAMENTAL_METRIC_CATALOG) as FundamentalMetricKey[])
    .filter((metricKey) => available.has(metricKey));
}

function parseMetricKeys(rawValue: string): FundamentalMetricKey[] {
  const values = rawValue.split(",").map((value) => value.trim());
  if (values.length === 0 || values.some((value) => !value || !isFundamentalMetricKey(value))) {
    throw new FundamentalApiQueryError("INVALID_METRICS", "Metrics contain an unknown metric key.");
  }
  return [...new Set(values as FundamentalMetricKey[])];
}

function parsePeriodCount(rawValue: string): number {
  if (!/^\d{1,2}$/.test(rawValue)) {
    throw new FundamentalApiQueryError("INVALID_PERIOD_COUNT", "Period count is invalid.");
  }
  const value = Number(rawValue);
  if (value < FUNDAMENTALS_MIN_PERIOD_COUNT || value > FUNDAMENTALS_MAX_PERIOD_COUNT) {
    throw new FundamentalApiQueryError(
      "INVALID_PERIOD_COUNT",
      `Period count must be between ${FUNDAMENTALS_MIN_PERIOD_COUNT} and ${FUNDAMENTALS_MAX_PERIOD_COUNT}.`,
    );
  }
  return value;
}

function currencyForPeriod(observations: FundamentalCurrentObservation[], periodEnd: string): string {
  return observations.find((observation) => observation.periodEnd === periodEnd && observation.currency)?.currency ?? "";
}

function defaultUnit(unitFamily: FundamentalUnitFamily): string {
  if (unitFamily === "percent") return "%";
  if (unitFamily === "shares") return "shares";
  if (unitFamily === "multiple") return "x";
  return "";
}

function parseTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function jsonResponse(value: unknown, status: number, cacheControl: string): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
      vary: "Origin",
    },
  });
}
