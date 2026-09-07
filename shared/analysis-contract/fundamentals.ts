export type FundamentalMetricCategory =
  | "income_statement"
  | "cash_flow"
  | "balance_sheet"
  | "per_share"
  | "ratio";

export type FundamentalUnitFamily = "currency" | "percent" | "per_share" | "shares";

export type FundamentalChartMark = "bar" | "line";

export type FundamentalTransform =
  | "value"
  | "qoq_growth"
  | "yoy_growth"
  | "qoq_change"
  | "yoy_change";

export type FundamentalDisplaySign = "as_reported" | "outflow_magnitude";

export type FundamentalMetricKey = "total_revenue" | "gross_profit" | "operating_income" | "net_income" | "diluted_eps" | "operating_cash_flow" | "capital_expenditure" | "free_cash_flow" | "stock_based_compensation" | "depreciation_and_amortization" | "research_and_development" | "cash_and_cash_equivalents" | "long_term_debt" | "total_assets" | "total_liabilities" | "stockholders_equity" | "inventory" | "accounts_receivable" | "ordinary_shares" | "gross_margin" | "operating_margin";

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
  schemaVersion: "fundamentals-api.v1";
  catalogVersion: "fundamental-metrics.v1";
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
