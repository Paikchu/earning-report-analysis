/**
 * Presentation helpers for the structured-report metrics the timeline shows.
 *
 * The analysis pipeline stores `metricKey`/`currentValue` exactly as the model
 * emitted them: snake_case English keys and raw magnitudes ("96221000000",
 * "0.7497531724"). That is the right storage shape — it stays comparable across
 * runs — but the disclosure timeline is a reading surface, so it needs a Chinese
 * label and a human magnitude.
 */

const METRIC_LABELS: Record<string, string> = {
  revenue: "营收",
  total_revenue: "营收",
  net_revenue: "营收",
  gross_profit: "毛利润",
  gross_margin: "毛利率",
  operating_income: "营业利润",
  operating_margin: "营业利润率",
  operating_expenses: "营业费用",
  net_income: "净利润",
  net_margin: "净利率",
  eps: "每股收益",
  diluted_eps: "摊薄 EPS",
  basic_eps: "基本 EPS",
  operating_cash_flow: "经营现金流",
  free_cash_flow: "自由现金流",
  capital_expenditure: "资本开支",
  research_and_development: "研发费用",
  cash_and_cash_equivalents: "现金及等价物",
  inventory: "存货",
  accounts_receivable: "应收账款",
  long_term_debt: "长期负债",
  total_debt: "总负债",
  total_assets: "总资产",
  total_liabilities: "总负债",
  stockholders_equity: "股东权益",
  data_center_revenue: "数据中心收入",
  gaming_revenue: "游戏收入",
  shares_outstanding: "在外股本",
};

/** Keys whose value is a ratio, whether the model stored 0.75 or 75. */
const RATIO_KEY = /(margin|ratio|rate|yield|growth|percent)$/;

export function formatSecMetricLabel(metricKey: string): string {
  const key = metricKey.trim().toLowerCase();
  return METRIC_LABELS[key] ?? metricKey.trim().replace(/_/g, " ");
}

/**
 * Render a stored metric value for reading. Anything that is not a bare number
 * is passed through untouched: the model sometimes already writes "962.2 亿美元"
 * or "not disclosed", and rewriting those would lose meaning.
 */
export function formatSecMetricValue(metricKey: string, rawValue: string): string {
  const value = rawValue.trim();
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;

  if (RATIO_KEY.test(metricKey.trim().toLowerCase())) {
    const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${percent.toFixed(1)}%`;
  }

  const magnitude = Math.abs(numeric);
  if (magnitude >= 1e8) return `${(numeric / 1e8).toFixed(1)} 亿`;
  if (magnitude >= 1e4) return `${(numeric / 1e4).toFixed(1)} 万`;
  if (magnitude >= 100) return numeric.toFixed(1);
  return numeric.toFixed(2);
}
