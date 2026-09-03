export const FUNDAMENTAL_METRIC_CATALOG_VERSION = "fundamental-metrics.v2";

export type FundamentalMetricCategory =
  | "income_statement"
  | "cash_flow"
  | "balance_sheet"
  | "per_share"
  | "valuation"
  | "ratio";

/** `multiple` is a unit-less ratio of price to a fundamental — P/E, EV/EBITDA. */
export type FundamentalUnitFamily = "currency" | "percent" | "per_share" | "shares" | "multiple";
export type FundamentalChartMark = "bar" | "line";
export type FundamentalTransform =
  | "value"
  | "qoq_growth"
  | "yoy_growth"
  | "qoq_change"
  | "yoy_change";
export type FundamentalDisplaySign = "as_reported" | "outflow_magnitude";

type ReportedMetricDefinition = {
  basis: "reported";
  yahooField: string;
  label: string;
  shortLabel: string;
  category: Exclude<FundamentalMetricCategory, "ratio">;
  unitFamily: Exclude<FundamentalUnitFamily, "percent">;
  defaultMark: FundamentalChartMark;
  displaySign: FundamentalDisplaySign;
  allowedTransforms: readonly FundamentalTransform[];
  colorRole: string;
};

type DerivedMetricDefinition = {
  basis: "derived";
  yahooField: null;
  label: string;
  shortLabel: string;
  category: "ratio";
  unitFamily: "percent";
  defaultMark: "line";
  displaySign: "as_reported";
  allowedTransforms: readonly FundamentalTransform[];
  colorRole: string;
  derivation: {
    kind: "ratio";
    numerator: string;
    denominator: string;
    scale: 100;
  };
};

const reportedMetrics = {
  total_revenue: {
    basis: "reported",
    yahooField: "quarterlyTotalRevenue",
    label: "营收",
    shortLabel: "营收",
    category: "income_statement",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "revenue",
  },
  gross_profit: {
    basis: "reported",
    yahooField: "quarterlyGrossProfit",
    label: "毛利润",
    shortLabel: "毛利",
    category: "income_statement",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "gross-profit",
  },
  operating_income: {
    basis: "reported",
    yahooField: "quarterlyOperatingIncome",
    label: "营业利润",
    shortLabel: "营业利润",
    category: "income_statement",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "operating-income",
  },
  net_income: {
    basis: "reported",
    yahooField: "quarterlyNetIncome",
    label: "净利润",
    shortLabel: "净利润",
    category: "income_statement",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "net-income",
  },
  diluted_eps: {
    basis: "reported",
    yahooField: "quarterlyDilutedEPS",
    label: "摊薄每股收益",
    shortLabel: "摊薄 EPS",
    category: "per_share",
    unitFamily: "per_share",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "eps",
  },
  operating_cash_flow: {
    basis: "reported",
    yahooField: "quarterlyOperatingCashFlow",
    label: "经营现金流",
    shortLabel: "经营现金流",
    category: "cash_flow",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "operating-cash-flow",
  },
  capital_expenditure: {
    basis: "reported",
    yahooField: "quarterlyCapitalExpenditure",
    label: "资本开支",
    shortLabel: "资本开支",
    category: "cash_flow",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "outflow_magnitude",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "capital-expenditure",
  },
  free_cash_flow: {
    basis: "reported",
    yahooField: "quarterlyFreeCashFlow",
    label: "自由现金流",
    shortLabel: "自由现金流",
    category: "cash_flow",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "free-cash-flow",
  },
  stock_based_compensation: {
    basis: "reported",
    yahooField: "quarterlyStockBasedCompensation",
    label: "股权激励",
    shortLabel: "SBC",
    category: "cash_flow",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "stock-based-compensation",
  },
  depreciation_and_amortization: {
    basis: "reported",
    yahooField: "quarterlyDepreciationAndAmortization",
    label: "折旧与摊销",
    shortLabel: "折旧摊销",
    category: "cash_flow",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "depreciation-amortization",
  },
  research_and_development: {
    basis: "reported",
    yahooField: "quarterlyResearchAndDevelopment",
    label: "研发费用",
    shortLabel: "研发",
    category: "income_statement",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "research-development",
  },
  cash_and_cash_equivalents: {
    basis: "reported",
    yahooField: "quarterlyCashAndCashEquivalents",
    label: "现金及现金等价物",
    shortLabel: "现金",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "cash",
  },
  long_term_debt: {
    basis: "reported",
    yahooField: "quarterlyLongTermDebt",
    label: "长期债务",
    shortLabel: "长期债务",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "long-term-debt",
  },
  total_assets: {
    basis: "reported",
    yahooField: "quarterlyTotalAssets",
    label: "总资产",
    shortLabel: "总资产",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "total-assets",
  },
  total_liabilities: {
    basis: "reported",
    yahooField: "quarterlyTotalLiabilitiesNetMinorityInterest",
    label: "总负债",
    shortLabel: "总负债",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "total-liabilities",
  },
  stockholders_equity: {
    basis: "reported",
    yahooField: "quarterlyStockholdersEquity",
    label: "股东权益",
    shortLabel: "股东权益",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "stockholders-equity",
  },
  inventory: {
    basis: "reported",
    yahooField: "quarterlyInventory",
    label: "存货",
    shortLabel: "存货",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "inventory",
  },
  accounts_receivable: {
    basis: "reported",
    yahooField: "quarterlyAccountsReceivable",
    label: "应收账款",
    shortLabel: "应收账款",
    category: "balance_sheet",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "accounts-receivable",
  },
  ordinary_shares: {
    basis: "reported",
    yahooField: "quarterlyOrdinarySharesNumber",
    label: "普通股股数",
    shortLabel: "股数",
    category: "balance_sheet",
    unitFamily: "shares",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "ordinary-shares",
  },
  market_cap: {
    basis: "reported",
    yahooField: "quarterlyMarketCap",
    label: "市值",
    shortLabel: "市值",
    category: "valuation",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "market-cap",
  },
  enterprise_value: {
    basis: "reported",
    yahooField: "quarterlyEnterpriseValue",
    label: "企业价值",
    shortLabel: "企业价值",
    category: "valuation",
    unitFamily: "currency",
    defaultMark: "bar",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "enterprise-value",
  },
  pe_ratio: {
    basis: "reported",
    yahooField: "quarterlyPeRatio",
    label: "市盈率 TTM",
    shortLabel: "市盈率",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "pe-ratio",
  },
  forward_pe_ratio: {
    basis: "reported",
    yahooField: "quarterlyForwardPeRatio",
    label: "预期市盈率",
    shortLabel: "预期 PE",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "forward-pe-ratio",
  },
  peg_ratio: {
    basis: "reported",
    yahooField: "quarterlyPegRatio",
    label: "PEG 五年预期",
    shortLabel: "PEG",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "peg-ratio",
  },
  price_to_sales: {
    basis: "reported",
    yahooField: "quarterlyPsRatio",
    label: "市销率",
    shortLabel: "市销率",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "price-to-sales",
  },
  price_to_book: {
    basis: "reported",
    yahooField: "quarterlyPbRatio",
    label: "市净率",
    shortLabel: "市净率",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "price-to-book",
  },
  ev_to_revenue: {
    basis: "reported",
    yahooField: "quarterlyEnterprisesValueRevenueRatio",
    label: "企业价值 / 收入",
    shortLabel: "EV/收入",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "ev-to-revenue",
  },
  ev_to_ebitda: {
    basis: "reported",
    yahooField: "quarterlyEnterprisesValueEBITDARatio",
    label: "企业价值 / EBITDA",
    shortLabel: "EV/EBITDA",
    category: "valuation",
    unitFamily: "multiple",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_growth", "yoy_growth"],
    colorRole: "ev-to-ebitda",
  },
} as const satisfies Record<string, ReportedMetricDefinition>;

const derivedMetrics = {
  gross_margin: {
    basis: "derived",
    yahooField: null,
    label: "毛利率",
    shortLabel: "毛利率",
    category: "ratio",
    unitFamily: "percent",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_change", "yoy_change"],
    colorRole: "gross-margin",
    derivation: { kind: "ratio", numerator: "gross_profit", denominator: "total_revenue", scale: 100 },
  },
  operating_margin: {
    basis: "derived",
    yahooField: null,
    label: "营业利润率",
    shortLabel: "营业利润率",
    category: "ratio",
    unitFamily: "percent",
    defaultMark: "line",
    displaySign: "as_reported",
    allowedTransforms: ["value", "qoq_change", "yoy_change"],
    colorRole: "operating-margin",
    derivation: { kind: "ratio", numerator: "operating_income", denominator: "total_revenue", scale: 100 },
  },
} as const satisfies Record<string, DerivedMetricDefinition>;

export const FUNDAMENTAL_METRIC_CATALOG = Object.freeze({
  ...reportedMetrics,
  ...derivedMetrics,
});

export type FundamentalMetricKey = keyof typeof FUNDAMENTAL_METRIC_CATALOG;
export type YahooQuarterlyFundamentalField = (typeof reportedMetrics)[keyof typeof reportedMetrics]["yahooField"];
export type FundamentalMetricDefinition = (typeof FUNDAMENTAL_METRIC_CATALOG)[FundamentalMetricKey];

const metricKeys = new Set<string>(Object.keys(FUNDAMENTAL_METRIC_CATALOG));
const yahooFieldToMetric = new Map<YahooQuarterlyFundamentalField, FundamentalMetricKey>();
const colorRoles = new Set<string>();

for (const [metricKey, definition] of Object.entries(FUNDAMENTAL_METRIC_CATALOG)) {
  if (colorRoles.has(definition.colorRole)) {
    throw new Error(`Duplicate fundamental metric color role: ${definition.colorRole}`);
  }
  colorRoles.add(definition.colorRole);

  if (definition.basis === "derived") {
    if (!metricKeys.has(definition.derivation.numerator) || !metricKeys.has(definition.derivation.denominator)) {
      throw new Error(`Derived fundamental metric ${metricKey} references an unknown source metric.`);
    }
    continue;
  }
  if (yahooFieldToMetric.has(definition.yahooField)) {
    throw new Error(`Duplicate Yahoo fundamental field: ${definition.yahooField}`);
  }
  yahooFieldToMetric.set(definition.yahooField, metricKey as FundamentalMetricKey);
}

export const YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS = Object.freeze([...yahooFieldToMetric.keys()]);

export function isFundamentalMetricKey(value: string): value is FundamentalMetricKey {
  return metricKeys.has(value);
}

export function isYahooQuarterlyFundamentalField(value: string): value is YahooQuarterlyFundamentalField {
  return yahooFieldToMetric.has(value as YahooQuarterlyFundamentalField);
}

export function getMetricKeyForYahooField(field: YahooQuarterlyFundamentalField): FundamentalMetricKey {
  return yahooFieldToMetric.get(field)!;
}

export function getFundamentalMetricDefinition(metricKey: FundamentalMetricKey): FundamentalMetricDefinition {
  return FUNDAMENTAL_METRIC_CATALOG[metricKey];
}
