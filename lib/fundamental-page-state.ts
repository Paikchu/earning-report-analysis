import type { PublicFundamentalSeries } from "./fundamentals-api.ts";
import {
  isFundamentalMetricKey,
  type FundamentalMetricKey,
} from "./fundamental-metrics.ts";
import { fundamentalSeriesAxisKey } from "./fundamental-chart.ts";

export const FUNDAMENTAL_PAGE_MAX_METRICS = 4;

export type FundamentalPageState = {
  metricKeys: FundamentalMetricKey[];
};

export type StockPageSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_FUNDAMENTAL_PAGE_STATE: Readonly<FundamentalPageState> = {
  metricKeys: ["total_revenue", "gross_margin"],
};

const DEFAULT_METRIC_PRIORITY: readonly FundamentalMetricKey[] = [
  "total_revenue",
  "gross_margin",
  "operating_income",
  "free_cash_flow",
];

export function parseFundamentalPageState(searchParams: URLSearchParams): FundamentalPageState {
  return { metricKeys: parseMetricKeys(searchParams.get("metrics")) };
}

export function hasExplicitFundamentalPageState(searchParams: URLSearchParams): boolean {
  return searchParams.has("metrics");
}

export function stockPageSearchParamsToUrlSearchParams(
  searchParams: StockPageSearchParams,
): URLSearchParams {
  const normalized = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) normalized.append(key, item);
    } else if (typeof value === "string") {
      normalized.set(key, value);
    }
  }
  return normalized;
}

export function writeFundamentalPageState(
  searchParams: URLSearchParams,
  state: FundamentalPageState,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  const normalized = normalizeFundamentalPageState(state);
  next.set("metrics", normalized.metricKeys.join(","));
  // Chart type and report range were reader settings once. Dropping them keeps a
  // shared link from carrying values the page no longer reads.
  next.delete("chart");
  next.delete("periods");
  return next;
}

export function normalizeFundamentalPageState(state: FundamentalPageState): FundamentalPageState {
  const metricKeys = uniqueMetricKeys(state.metricKeys).slice(0, FUNDAMENTAL_PAGE_MAX_METRICS);
  return {
    metricKeys: metricKeys.length > 0
      ? metricKeys
      : [...DEFAULT_FUNDAMENTAL_PAGE_STATE.metricKeys],
  };
}

export function reconcileFundamentalMetricSelection(
  selectedMetricKeys: readonly FundamentalMetricKey[],
  availableMetricKeys: readonly FundamentalMetricKey[],
): FundamentalMetricKey[] {
  const available = new Set(availableMetricKeys);
  const retained = uniqueMetricKeys(selectedMetricKeys)
    .filter((metricKey) => available.has(metricKey))
    .slice(0, FUNDAMENTAL_PAGE_MAX_METRICS);
  if (retained.length > 0) return retained;

  const defaults = DEFAULT_METRIC_PRIORITY.filter((metricKey) => available.has(metricKey)).slice(0, 2);
  if (defaults.length > 0) return defaults;
  return uniqueMetricKeys(availableMetricKeys).slice(0, 2);
}

export function limitFundamentalMetricAxes(
  selectedMetricKeys: readonly FundamentalMetricKey[],
  availableSeries: readonly PublicFundamentalSeries[],
  maxAxes = 2,
): FundamentalMetricKey[] {
  const seriesByKey = new Map(availableSeries.map((series) => [series.metricKey, series]));
  const axisKeys = new Set<string>();
  return selectedMetricKeys.filter((metricKey) => {
    const series = seriesByKey.get(metricKey);
    if (!series) return false;
    const axisKey = fundamentalSeriesAxisKey(series);
    if (axisKeys.has(axisKey)) return true;
    if (axisKeys.size >= maxAxes) return false;
    axisKeys.add(axisKey);
    return true;
  });
}

function parseMetricKeys(raw: string | null): FundamentalMetricKey[] {
  if (!raw) return [...DEFAULT_FUNDAMENTAL_PAGE_STATE.metricKeys];
  const metricKeys = uniqueMetricKeys(raw.split(",").map((value) => value.trim()))
    .slice(0, FUNDAMENTAL_PAGE_MAX_METRICS);
  return metricKeys.length > 0 ? metricKeys : [...DEFAULT_FUNDAMENTAL_PAGE_STATE.metricKeys];
}

function uniqueMetricKeys(values: readonly string[]): FundamentalMetricKey[] {
  const seen = new Set<FundamentalMetricKey>();
  const result: FundamentalMetricKey[] = [];
  for (const value of values) {
    if (!isFundamentalMetricKey(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
