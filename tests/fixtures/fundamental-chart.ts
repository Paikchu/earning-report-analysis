import {
  FUNDAMENTAL_METRIC_CATALOG,
  type FundamentalMetricKey,
} from "../../lib/fundamental-metrics.ts";
import {
  FUNDAMENTALS_API_SCHEMA_VERSION,
  type PublicFundamentalsResponse,
  type PublicFundamentalSeries,
} from "../../lib/fundamentals-api.ts";
import { FUNDAMENTAL_METRIC_CATALOG_VERSION } from "../../lib/fundamental-metrics.ts";

export const CHART_FIXTURE_PERIOD_ENDS = [
  "2024-03-31",
  "2024-06-30",
  "2024-09-30",
  "2024-12-31",
  "2025-03-31",
  "2025-06-30",
] as const;

const VALUES: Partial<Record<FundamentalMetricKey, readonly (number | null)[]>> = {
  total_revenue: [100_000_000, 120_000_000, 90_000_000, null, 150_000_000, 180_000_000],
  gross_profit: [40_000_000, 50_400_000, 36_900_000, 55_900_000, 66_000_000, 81_000_000],
  gross_margin: [40, 42, 41, 43, 44, 45],
  operating_income: [10_000_000, 12_000_000, -5_000_000, 8_000_000, 15_000_000, 18_000_000],
  free_cash_flow: [8_000_000, -2_000_000, 6_000_000, 9_000_000, 11_000_000, 13_000_000],
  capital_expenditure: [-4_000_000, -5_000_000, -3_000_000, -6_000_000, -7_000_000, -8_000_000],
  diluted_eps: [0.8, 0.9, 0.4, 0.7, 1.1, 1.2],
  ordinary_shares: [50_000_000, 50_200_000, 50_400_000, 50_600_000, 50_800_000, 51_000_000],
};

export function makeChartSeries(
  metricKey: FundamentalMetricKey,
  values = VALUES[metricKey] ?? CHART_FIXTURE_PERIOD_ENDS.map(() => null),
): PublicFundamentalSeries {
  const definition = FUNDAMENTAL_METRIC_CATALOG[metricKey];
  const currency = definition.unitFamily === "currency" || definition.unitFamily === "per_share" ? "USD" : "";
  const unit = definition.unitFamily === "percent"
    ? "percent"
    : definition.unitFamily === "shares"
      ? "shares"
      : "USD";
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
    available: values.some((value) => value !== null),
    points: CHART_FIXTURE_PERIOD_ENDS.map((periodEnd, index) => ({
      periodEnd,
      valueDecimal: values[index]?.toString() ?? null,
      revision: values[index] === null ? null : 1,
    })),
  };
}

export function makeChartResponse(
  series: readonly PublicFundamentalSeries[] = [
    makeChartSeries("total_revenue"),
    makeChartSeries("gross_margin"),
    makeChartSeries("operating_income"),
    makeChartSeries("free_cash_flow"),
    makeChartSeries("diluted_eps"),
    makeChartSeries("ordinary_shares"),
  ],
): PublicFundamentalsResponse {
  return {
    schemaVersion: FUNDAMENTALS_API_SCHEMA_VERSION,
    catalogVersion: FUNDAMENTAL_METRIC_CATALOG_VERSION,
    source: "yahoo_finance",
    ticker: "ACME",
    status: "ready",
    dataVersion: "fixture-v1",
    fetchedAt: "2025-07-01T00:00:00.000Z",
    stale: true,
    partial: true,
    qualityStatus: "partial",
    issueCount: 1,
    requestedPeriodCount: CHART_FIXTURE_PERIOD_ENDS.length,
    periods: CHART_FIXTURE_PERIOD_ENDS.map((periodEnd) => ({
      periodType: "3M",
      periodEnd,
      currency: "USD",
    })),
    series: [...series],
    refresh: { recommended: true, scheduled: false },
  };
}

export function makePendingChartResponse(): PublicFundamentalsResponse {
  return {
    ...makeChartResponse([]),
    status: "pending",
    dataVersion: null,
    fetchedAt: null,
    partial: false,
    qualityStatus: null,
    issueCount: 0,
    periods: [],
    series: [],
    refresh: { recommended: true, scheduled: true },
  };
}
