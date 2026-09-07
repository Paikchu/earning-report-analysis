import type { FundamentalMetricKey } from "../../shared/analysis-contract/fundamentals.ts";
export type * from "../../shared/analysis-contract/fundamentals.ts";
export const FUNDAMENTAL_METRIC_CATALOG = {
  "total_revenue": {
    "basis": "reported",
    "label": "营收",
    "shortLabel": "营收",
    "category": "income_statement",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "revenue"
  },
  "gross_profit": {
    "basis": "reported",
    "label": "毛利润",
    "shortLabel": "毛利",
    "category": "income_statement",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "gross-profit"
  },
  "operating_income": {
    "basis": "reported",
    "label": "营业利润",
    "shortLabel": "营业利润",
    "category": "income_statement",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "operating-income"
  },
  "net_income": {
    "basis": "reported",
    "label": "净利润",
    "shortLabel": "净利润",
    "category": "income_statement",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "net-income"
  },
  "diluted_eps": {
    "basis": "reported",
    "label": "摊薄每股收益",
    "shortLabel": "摊薄 EPS",
    "category": "per_share",
    "unitFamily": "per_share",
    "defaultMark": "line",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "eps"
  },
  "operating_cash_flow": {
    "basis": "reported",
    "label": "经营现金流",
    "shortLabel": "经营现金流",
    "category": "cash_flow",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "operating-cash-flow"
  },
  "capital_expenditure": {
    "basis": "reported",
    "label": "资本开支",
    "shortLabel": "资本开支",
    "category": "cash_flow",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "outflow_magnitude",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "capital-expenditure"
  },
  "free_cash_flow": {
    "basis": "reported",
    "label": "自由现金流",
    "shortLabel": "自由现金流",
    "category": "cash_flow",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "free-cash-flow"
  },
  "stock_based_compensation": {
    "basis": "reported",
    "label": "股权激励",
    "shortLabel": "SBC",
    "category": "cash_flow",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "stock-based-compensation"
  },
  "depreciation_and_amortization": {
    "basis": "reported",
    "label": "折旧与摊销",
    "shortLabel": "折旧摊销",
    "category": "cash_flow",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "depreciation-amortization"
  },
  "research_and_development": {
    "basis": "reported",
    "label": "研发费用",
    "shortLabel": "研发",
    "category": "income_statement",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "research-development"
  },
  "cash_and_cash_equivalents": {
    "basis": "reported",
    "label": "现金及现金等价物",
    "shortLabel": "现金",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "cash"
  },
  "long_term_debt": {
    "basis": "reported",
    "label": "长期债务",
    "shortLabel": "长期债务",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "long-term-debt"
  },
  "total_assets": {
    "basis": "reported",
    "label": "总资产",
    "shortLabel": "总资产",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "total-assets"
  },
  "total_liabilities": {
    "basis": "reported",
    "label": "总负债",
    "shortLabel": "总负债",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "total-liabilities"
  },
  "stockholders_equity": {
    "basis": "reported",
    "label": "股东权益",
    "shortLabel": "股东权益",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "stockholders-equity"
  },
  "inventory": {
    "basis": "reported",
    "label": "存货",
    "shortLabel": "存货",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "inventory"
  },
  "accounts_receivable": {
    "basis": "reported",
    "label": "应收账款",
    "shortLabel": "应收账款",
    "category": "balance_sheet",
    "unitFamily": "currency",
    "defaultMark": "bar",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "accounts-receivable"
  },
  "ordinary_shares": {
    "basis": "reported",
    "label": "普通股股数",
    "shortLabel": "股数",
    "category": "balance_sheet",
    "unitFamily": "shares",
    "defaultMark": "line",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_growth",
      "yoy_growth"
    ],
    "colorRole": "ordinary-shares"
  },
  "gross_margin": {
    "basis": "derived",
    "label": "毛利率",
    "shortLabel": "毛利率",
    "category": "ratio",
    "unitFamily": "percent",
    "defaultMark": "line",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_change",
      "yoy_change"
    ],
    "colorRole": "gross-margin",
    "derivation": {
      "kind": "ratio",
      "numerator": "gross_profit",
      "denominator": "total_revenue",
      "scale": 100
    }
  },
  "operating_margin": {
    "basis": "derived",
    "label": "营业利润率",
    "shortLabel": "营业利润率",
    "category": "ratio",
    "unitFamily": "percent",
    "defaultMark": "line",
    "displaySign": "as_reported",
    "allowedTransforms": [
      "value",
      "qoq_change",
      "yoy_change"
    ],
    "colorRole": "operating-margin",
    "derivation": {
      "kind": "ratio",
      "numerator": "operating_income",
      "denominator": "total_revenue",
      "scale": 100
    }
  }
} as const;
export function isFundamentalMetricKey(value: string): value is FundamentalMetricKey { return Object.hasOwn(FUNDAMENTAL_METRIC_CATALOG, value); }
