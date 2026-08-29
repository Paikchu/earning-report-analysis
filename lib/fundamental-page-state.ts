import {
  FUNDAMENTALS_DEFAULT_PERIOD_COUNT,
  FUNDAMENTALS_MAX_PERIOD_COUNT,
  FUNDAMENTALS_MIN_PERIOD_COUNT,
  type PublicFundamentalSeries,
} from "./fundamentals-api.ts";
import {
  isFundamentalMetricKey,
  type FundamentalMetricKey,
} from "./fundamental-metrics.ts";
import { fundamentalSeriesAxisKey } from "./fundamental-chart.ts";

export const FUNDAMENTAL_PAGE_MAX_METRICS = 4;
export const FUNDAMENTAL_PAGE_PERIOD_OPTIONS = [5, 8, 12] as const;

export type FundamentalChartMode = "combo" | "bar" | "line";

export type FundamentalPageState = {
  metricKeys: FundamentalMetricKey[];
  chart: FundamentalChartMode;
  periodCount: number;
};

export type StockPageSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_FUNDAMENTAL_PAGE_STATE: Readonly<FundamentalPageState> = {
  metricKeys: ["total_revenue", "gross_margin"],
  chart: "combo",
  periodCount: FUNDAMENTALS_DEFAULT_PERIOD_COUNT,
};

const DEFAULT_METRIC_PRIORITY: readonly FundamentalMetricKey[] = [
  "total_revenue",
  "gross_margin",
  "operating_income",
  "free_cash_flow",
];

export function parseFundamentalPageState(searchParams: URLSearchParams): FundamentalPageState {
  return {
    metricKeys: parseMetricKeys(searchParams.get("metrics")),
    chart: parseChartMode(searchParams.get("chart")),
    periodCount: parsePeriodCount(searchParams.get("periods")),
  };
}

export function hasExplicitFundamentalPageState(searchParams: URLSearchParams): boolean {
  return searchParams.has("metrics") || searchParams.has("chart") || searchParams.has("periods");
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
  next.set("chart", normalized.chart);
  next.set("periods", String(normalized.periodCount));
  return next;
}

export function normalizeFundamentalPageState(state: FundamentalPageState): FundamentalPageState {
  const metricKeys = uniqueMetricKeys(state.metricKeys).slice(0, FUNDAMENTAL_PAGE_MAX_METRICS);
  return {
    metricKeys: metricKeys.length > 0
      ? metricKeys
      : [...DEFAULT_FUNDAMENTAL_PAGE_STATE.metricKeys],
    chart: parseChartMode(state.chart),
    periodCount: parsePeriodCount(String(state.periodCount)),
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

function parseChartMode(raw: string | null): FundamentalChartMode {
  return raw === "bar" || raw === "line" || raw === "combo" ? raw : "combo";
}

function parsePeriodCount(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return FUNDAMENTALS_DEFAULT_PERIOD_COUNT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < FUNDAMENTALS_MIN_PERIOD_COUNT || value > FUNDAMENTALS_MAX_PERIOD_COUNT) {
    return FUNDAMENTALS_DEFAULT_PERIOD_COUNT;
  }
  return FUNDAMENTAL_PAGE_PERIOD_OPTIONS.some((option) => option === value)
    ? value
    : FUNDAMENTALS_DEFAULT_PERIOD_COUNT;
}
