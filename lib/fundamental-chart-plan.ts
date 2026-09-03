import {
  FUNDAMENTAL_CHART_MAX_SERIES,
  FundamentalChartSpecError,
  buildFundamentalChartModel,
  type FundamentalChartAxisSide,
  type FundamentalChartSeriesSpec,
} from "./fundamental-chart.ts";
import {
  FUNDAMENTAL_METRIC_CATALOG,
  isFundamentalMetricKey,
  type FundamentalChartMark,
  type FundamentalMetricKey,
  type FundamentalTransform,
} from "./fundamental-metrics.ts";
import type { PublicFundamentalsResponse } from "./fundamentals-api.ts";

export const FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION = "fundamental-chart-plan.v1";
export const FUNDAMENTAL_COMPANY_PROFILE_VERSION = "fundamental-company-profile.v1";
export const FUNDAMENTAL_PRESET_VERSION = "fundamental-preset.v1";
// A plan is exactly one chart. Rules fold what they want emphasised into that
// chart (see buildCoreChart) instead of ever handing the page a second panel.
export const FUNDAMENTAL_CHART_PLAN_CHART_COUNT = 1;
export const FUNDAMENTAL_CHART_PLAN_PERIOD_OPTIONS = [5, 8, 12] as const;

export type FundamentalCompanyClassification =
  | "capital_intensive"
  | "growth_investing"
  | "mature_cash_generator"
  | "balanced";

export type FundamentalCompanyProfile = {
  profileVersion: typeof FUNDAMENTAL_COMPANY_PROFILE_VERSION;
  ticker: string;
  inputDataHash: string;
  classification: FundamentalCompanyClassification;
  features: {
    capitalExpenditureIntensityPct: number | null;
    capitalExpenditureLatestQoqPct: number | null;
    researchIntensityPct: number | null;
    freeCashFlowConversionPct: number | null;
    grossMarginTrendPp: number | null;
    revenueGrowthVolatilityPct: number | null;
  };
  guardrailMetrics: FundamentalMetricKey[];
};

export type FundamentalChartPlanSeries = Required<
  Pick<FundamentalChartSeriesSpec, "metricKey" | "mark" | "transform">
> & Pick<FundamentalChartSeriesSpec, "axis">;

export type FundamentalChartPlanChart = {
  id: string;
  title: string;
  insight?: string;
  periodCount: (typeof FUNDAMENTAL_CHART_PLAN_PERIOD_OPTIONS)[number];
  series: FundamentalChartPlanSeries[];
};

export type FundamentalChartPlanProvenance =
  | { kind: "ai"; modelVersion: string; promptVersion: string }
  | { kind: "preset"; presetVersion: typeof FUNDAMENTAL_PRESET_VERSION }
  | { kind: "url" }
  | { kind: "user" };

export type FundamentalChartPlan = {
  schemaVersion: typeof FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION;
  ticker: string;
  inputDataHash: string;
  provenance: FundamentalChartPlanProvenance;
  charts: readonly [FundamentalChartPlanChart];
};

export type FundamentalChartPlanIssue = {
  code:
    | "INVALID_OBJECT"
    | "UNKNOWN_FIELD"
    | "SCHEMA_VERSION"
    | "TICKER_MISMATCH"
    | "STALE_INPUT_DATA"
    | "MISSING_PROVENANCE"
    | "CHART_COUNT"
    | "INVALID_CHART"
    | "INVALID_SERIES"
    | "UNAVAILABLE_METRIC"
    | "CHART_SPEC_INVALID"
    | "MISSING_GUARDRAIL_METRIC"
    | "DATA_NOT_READY";
  path: string;
  message: string;
};

export type FundamentalChartPlanValidation =
  | { ok: true; plan: FundamentalChartPlan; issues: [] }
  | { ok: false; plan: null; issues: FundamentalChartPlanIssue[] };

export type FundamentalChartOverride = {
  metricKeys: readonly FundamentalMetricKey[];
  periodCount: number;
};

export type ResolvedFundamentalPresentation = {
  source: FundamentalChartPlanProvenance["kind"];
  plan: FundamentalChartPlan;
  profile: FundamentalCompanyProfile;
  rejectedAiIssues: FundamentalChartPlanIssue[];
};

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "ticker",
  "inputDataHash",
  "modelVersion",
  "promptVersion",
  "charts",
]);
const CHART_KEYS = new Set(["id", "title", "insight", "periodCount", "series"]);
const SERIES_KEYS = new Set(["metricKey", "mark", "transform", "axis"]);
const VALID_MARKS = new Set<FundamentalChartMark>(["bar", "line"]);
const VALID_TRANSFORMS = new Set<FundamentalTransform>([
  "value",
  "qoq_growth",
  "yoy_growth",
  "qoq_change",
  "yoy_change",
]);
const VALID_AXES = new Set<FundamentalChartAxisSide>(["left", "right"]);

export const FUNDAMENTAL_AI_CHART_PLAN_JSON_SCHEMA = Object.freeze({
  $id: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "ticker", "inputDataHash", "modelVersion", "promptVersion", "charts"],
  properties: {
    schemaVersion: { const: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION },
    ticker: { type: "string", minLength: 1 },
    inputDataHash: { type: "string", minLength: 1 },
    modelVersion: { type: "string", minLength: 1, maxLength: 80 },
    promptVersion: { type: "string", minLength: 1, maxLength: 80 },
    charts: {
      type: "array",
      minItems: FUNDAMENTAL_CHART_PLAN_CHART_COUNT,
      maxItems: FUNDAMENTAL_CHART_PLAN_CHART_COUNT,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "periodCount", "series"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,47}$" },
          title: { type: "string", minLength: 1, maxLength: 80 },
          insight: { type: "string", maxLength: 180 },
          periodCount: { enum: FUNDAMENTAL_CHART_PLAN_PERIOD_OPTIONS },
          series: {
            type: "array",
            minItems: 1,
            maxItems: FUNDAMENTAL_CHART_MAX_SERIES,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["metricKey", "mark", "transform"],
              properties: {
                metricKey: { enum: Object.keys(FUNDAMENTAL_METRIC_CATALOG) },
                mark: { enum: ["bar", "line"] },
                transform: { enum: [...VALID_TRANSFORMS] },
                axis: { enum: ["left", "right"] },
              },
            },
          },
        },
      },
    },
  },
} as const);

export function buildFundamentalCompanyProfile(
  data: PublicFundamentalsResponse,
): FundamentalCompanyProfile | null {
  if (data.status !== "ready" || !data.dataVersion) return null;
  const capitalExpenditureIntensityPct = alignedMagnitudeRatio(
    data,
    "capital_expenditure",
    "total_revenue",
  );
  const researchIntensityPct = alignedMagnitudeRatio(
    data,
    "research_and_development",
    "total_revenue",
  );
  const freeCashFlowConversionPct = alignedSignedRatio(
    data,
    "free_cash_flow",
    availableSeries(data, "operating_cash_flow") ? "operating_cash_flow" : "operating_income",
  );
  const grossMarginTrendPp = firstToLastChange(data, "gross_margin");
  const revenueGrowthVolatilityPct = growthVolatility(data, "total_revenue");
  const capitalExpenditureLatestQoqPct = latestMagnitudeGrowth(data, "capital_expenditure");
  const guardrailMetrics: FundamentalMetricKey[] = [];
  if (
    (capitalExpenditureIntensityPct !== null && capitalExpenditureIntensityPct >= 10)
    || (capitalExpenditureLatestQoqPct !== null && capitalExpenditureLatestQoqPct >= 50)
  ) {
    guardrailMetrics.push("capital_expenditure");
  }

  const classification: FundamentalCompanyClassification = guardrailMetrics.includes("capital_expenditure")
    ? "capital_intensive"
    : researchIntensityPct !== null && researchIntensityPct >= 12
      ? "growth_investing"
      : freeCashFlowConversionPct !== null
          && freeCashFlowConversionPct >= 65
          && (revenueGrowthVolatilityPct === null || revenueGrowthVolatilityPct <= 12)
        ? "mature_cash_generator"
        : "balanced";

  return {
    profileVersion: FUNDAMENTAL_COMPANY_PROFILE_VERSION,
    ticker: data.ticker,
    inputDataHash: data.dataVersion,
    classification,
    features: {
      capitalExpenditureIntensityPct,
      capitalExpenditureLatestQoqPct,
      researchIntensityPct,
      freeCashFlowConversionPct,
      grossMarginTrendPp,
      revenueGrowthVolatilityPct,
    },
    guardrailMetrics,
  };
}

export function validateAiFundamentalChartPlan(
  candidate: unknown,
  data: PublicFundamentalsResponse,
  profile = buildFundamentalCompanyProfile(data),
): FundamentalChartPlanValidation {
  const issues: FundamentalChartPlanIssue[] = [];
  if (data.status !== "ready" || !data.dataVersion || !profile) {
    return invalid([{ code: "DATA_NOT_READY", path: "$", message: "基本面数据尚未形成可验证版本。" }]);
  }
  if (!isRecord(candidate)) {
    return invalid([{ code: "INVALID_OBJECT", path: "$", message: "ChartPlan 必须是 JSON object。" }]);
  }
  checkUnknownFields(candidate, TOP_LEVEL_KEYS, "$", issues);

  if (candidate.schemaVersion !== FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION) {
    issues.push({ code: "SCHEMA_VERSION", path: "$.schemaVersion", message: "ChartPlan schemaVersion 不受支持。" });
  }
  if (candidate.ticker !== data.ticker) {
    issues.push({ code: "TICKER_MISMATCH", path: "$.ticker", message: "ChartPlan ticker 与当前公司不一致。" });
  }
  if (candidate.inputDataHash !== data.dataVersion) {
    issues.push({ code: "STALE_INPUT_DATA", path: "$.inputDataHash", message: "ChartPlan 基于陈旧或不同的数据版本。" });
  }
  const modelVersion = boundedString(candidate.modelVersion, 80);
  const promptVersion = boundedString(candidate.promptVersion, 80);
  if (!modelVersion || !promptVersion) {
    issues.push({ code: "MISSING_PROVENANCE", path: "$", message: "AI ChartPlan 必须记录模型与提示词版本。" });
  }

  const rawCharts = Array.isArray(candidate.charts) ? candidate.charts : [];
  if (rawCharts.length !== FUNDAMENTAL_CHART_PLAN_CHART_COUNT) {
    issues.push({
      code: "CHART_COUNT",
      path: "$.charts",
      message: `ChartPlan 必须且只能包含 ${FUNDAMENTAL_CHART_PLAN_CHART_COUNT} 张图。`,
    });
  }
  // A surplus chart is rejected outright rather than truncated: a model that asked
  // for two panels planned against a layout this page does not have, so fall back.
  const chart = rawCharts.length === FUNDAMENTAL_CHART_PLAN_CHART_COUNT
    ? parseChart(rawCharts[0], "$.charts[0]", data, issues)
    : null;

  for (const metricKey of profile.guardrailMetrics) {
    if (!chart?.series.some((series) => series.metricKey === metricKey)) {
      issues.push({
        code: "MISSING_GUARDRAIL_METRIC",
        path: "$.charts",
        message: `确定性 guardrail 要求展示 ${FUNDAMENTAL_METRIC_CATALOG[metricKey].label}。`,
      });
    }
  }
  if (issues.length > 0 || !modelVersion || !promptVersion || !chart) return invalid(issues);

  return {
    ok: true,
    issues: [],
    plan: {
      schemaVersion: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
      ticker: data.ticker,
      inputDataHash: data.dataVersion,
      provenance: { kind: "ai", modelVersion, promptVersion },
      charts: [chart],
    },
  };
}

export function buildDeterministicFundamentalChartPlan(
  data: PublicFundamentalsResponse,
  profile = buildFundamentalCompanyProfile(data),
): FundamentalChartPlan {
  if (data.status !== "ready" || !data.dataVersion || !profile) {
    throw new Error("Cannot build a deterministic chart plan without ready fundamentals data.");
  }
  const periodCount = normalizePlanPeriodCount(data.requestedPeriodCount);
  // Whatever the rules want emphasised rides the core chart, so the preset always
  // opens on exactly one panel instead of splitting for a single extra series.
  const emphasisMetrics: FundamentalMetricKey[] = [...profile.guardrailMetrics];
  if (profile.classification === "growth_investing") {
    emphasisMetrics.push("research_and_development");
  }

  return {
    schemaVersion: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
    ticker: data.ticker,
    inputDataHash: data.dataVersion,
    provenance: { kind: "preset", presetVersion: FUNDAMENTAL_PRESET_VERSION },
    charts: [buildCoreChart(data, periodCount, emphasisMetrics)],
  };
}

export function resolveFundamentalPresentation({
  data,
  userOverride,
  urlOverride,
  aiCandidate,
}: {
  data: PublicFundamentalsResponse;
  userOverride?: FundamentalChartOverride | null;
  urlOverride?: FundamentalChartOverride | null;
  aiCandidate?: unknown;
}): ResolvedFundamentalPresentation {
  const profile = buildFundamentalCompanyProfile(data);
  if (!profile) throw new Error("Cannot resolve a chart presentation without ready fundamentals data.");
  if (userOverride) {
    return { source: "user", plan: buildOverridePlan(data, userOverride, "user"), profile, rejectedAiIssues: [] };
  }
  if (urlOverride) {
    return { source: "url", plan: buildOverridePlan(data, urlOverride, "url"), profile, rejectedAiIssues: [] };
  }
  if (aiCandidate !== undefined && aiCandidate !== null) {
    const validation = validateAiFundamentalChartPlan(aiCandidate, data, profile);
    if (validation.ok) return { source: "ai", plan: validation.plan, profile, rejectedAiIssues: [] };
    return {
      source: "preset",
      plan: buildDeterministicFundamentalChartPlan(data, profile),
      profile,
      rejectedAiIssues: validation.issues,
    };
  }
  return {
    source: "preset",
    plan: buildDeterministicFundamentalChartPlan(data, profile),
    profile,
    rejectedAiIssues: [],
  };
}

export function sliceFundamentalsForChart(
  data: PublicFundamentalsResponse,
  periodCount: number,
): PublicFundamentalsResponse {
  const periods = data.periods.slice(-periodCount);
  const periodEnds = new Set(periods.map((period) => period.periodEnd));
  return {
    ...data,
    requestedPeriodCount: periodCount,
    periods,
    series: data.series.map((series) => ({
      ...series,
      points: series.points.filter((point) => periodEnds.has(point.periodEnd)),
    })),
  };
}

function parseChart(
  raw: unknown,
  path: string,
  data: PublicFundamentalsResponse,
  issues: FundamentalChartPlanIssue[],
): FundamentalChartPlanChart | null {
  if (!isRecord(raw)) {
    issues.push({ code: "INVALID_CHART", path, message: "图表配置必须是 object。" });
    return null;
  }
  checkUnknownFields(raw, CHART_KEYS, path, issues);
  const id = boundedString(raw.id, 48);
  const title = boundedString(raw.title, 80);
  const insight = raw.insight === undefined ? undefined : boundedString(raw.insight, 180);
  const periodCount = typeof raw.periodCount === "number"
    && FUNDAMENTAL_CHART_PLAN_PERIOD_OPTIONS.some((value) => value === raw.periodCount)
    ? raw.periodCount as FundamentalChartPlanChart["periodCount"]
    : null;
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id) || !title || (raw.insight !== undefined && insight === undefined) || !periodCount) {
    issues.push({ code: "INVALID_CHART", path, message: "图表 id、标题、说明或 periodCount 不合法。" });
  }

  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  if (rawSeries.length < 1 || rawSeries.length > FUNDAMENTAL_CHART_MAX_SERIES) {
    issues.push({
      code: "INVALID_SERIES",
      path: `${path}.series`,
      message: `每张图必须包含 1–${FUNDAMENTAL_CHART_MAX_SERIES} 条序列。`,
    });
  }
  const parsedSeries = rawSeries.slice(0, FUNDAMENTAL_CHART_MAX_SERIES)
    .map((series, index) => parseSeries(series, `${path}.series[${index}]`, data, issues))
    .filter((series): series is FundamentalChartPlanSeries => series !== null);
  if (parsedSeries.length === rawSeries.length && parsedSeries.length > 0) {
    try {
      buildFundamentalChartModel(
        sliceFundamentalsForChart(data, periodCount ?? 5).periods,
        data.series,
        parsedSeries,
      );
    } catch (error) {
      issues.push({
        code: "CHART_SPEC_INVALID",
        path: `${path}.series`,
        message: error instanceof FundamentalChartSpecError ? error.message : "图表序列无法通过确定性校验。",
      });
    }
  }
  if (!id || !title || !periodCount || parsedSeries.length !== rawSeries.length || parsedSeries.length === 0) return null;
  return { id, title, ...(insight ? { insight } : {}), periodCount, series: parsedSeries };
}

function parseSeries(
  raw: unknown,
  path: string,
  data: PublicFundamentalsResponse,
  issues: FundamentalChartPlanIssue[],
): FundamentalChartPlanSeries | null {
  if (!isRecord(raw)) {
    issues.push({ code: "INVALID_SERIES", path, message: "series 必须是 object。" });
    return null;
  }
  checkUnknownFields(raw, SERIES_KEYS, path, issues);
  const metricKey = typeof raw.metricKey === "string" && isFundamentalMetricKey(raw.metricKey)
    ? raw.metricKey
    : null;
  const mark = typeof raw.mark === "string" && VALID_MARKS.has(raw.mark as FundamentalChartMark)
    ? raw.mark as FundamentalChartMark
    : null;
  const transform = typeof raw.transform === "string" && VALID_TRANSFORMS.has(raw.transform as FundamentalTransform)
    ? raw.transform as FundamentalTransform
    : null;
  const axis = raw.axis === undefined
    ? undefined
    : typeof raw.axis === "string" && VALID_AXES.has(raw.axis as FundamentalChartAxisSide)
      ? raw.axis as FundamentalChartAxisSide
      : null;
  if (!metricKey || !mark || !transform || axis === null) {
    issues.push({ code: "INVALID_SERIES", path, message: "series 的 metricKey、mark、transform 或 axis 不合法。" });
    return null;
  }
  const source = data.series.find((series) => series.metricKey === metricKey);
  if (!source?.available) {
    issues.push({ code: "UNAVAILABLE_METRIC", path: `${path}.metricKey`, message: `当前数据没有 ${metricKey}。` });
    return null;
  }
  if (!source.allowedTransforms.includes(transform)) {
    issues.push({ code: "INVALID_SERIES", path: `${path}.transform`, message: `${metricKey} 不支持 ${transform}。` });
    return null;
  }
  return { metricKey, mark, transform, ...(axis ? { axis } : {}) };
}

function buildCoreChart(
  data: PublicFundamentalsResponse,
  periodCount: FundamentalChartPlanChart["periodCount"],
  emphasisMetrics: readonly FundamentalMetricKey[] = [],
): FundamentalChartPlanChart {
  const series: FundamentalChartPlanSeries[] = [];
  if (availableSeries(data, "total_revenue")) {
    series.push({ metricKey: "total_revenue", mark: "bar", transform: "value", axis: "left" });
  }
  if (availableSeries(data, "gross_margin")) {
    series.push({ metricKey: "gross_margin", mark: "line", transform: "value", axis: "right" });
  } else if (availableSeries(data, "operating_income")) {
    series.push({ metricKey: "operating_income", mark: "line", transform: "value", axis: "left" });
  }
  if (series.length === 0) {
    const fallback = data.series.find((candidate) => candidate.available);
    if (!fallback) throw new Error("Cannot build a chart plan without an available metric.");
    series.push({
      metricKey: fallback.metricKey,
      mark: fallback.defaultMark,
      transform: "value",
      axis: "left",
    });
  }

  // Capex and R&D are currency like revenue, so an emphasis metric joins the axis
  // the core chart already draws instead of earning a chart of its own.
  const merged = [...series];
  const emphasisLabels: string[] = [];
  for (const metricKey of emphasisMetrics) {
    const source = data.series.find((candidate) => candidate.metricKey === metricKey);
    if (!source?.available) continue;
    if (merged.some((existing) => existing.metricKey === metricKey)) continue;
    // Axis stays unset: a same-unit metric lands on the axis its unit already owns,
    // and only a genuinely different unit is pushed to the opposite side.
    const candidate: FundamentalChartPlanSeries = {
      metricKey,
      mark: source.defaultMark,
      transform: "value",
    };
    try {
      buildFundamentalChartModel(
        sliceFundamentalsForChart(data, periodCount).periods,
        data.series,
        [...merged, candidate],
      );
      merged.push(candidate);
      emphasisLabels.push(source.label);
    } catch {
      // The axis or series budget cannot take this metric. Keep the core chart
      // renderable rather than emitting a spec the chart model would reject.
    }
  }

  const emphasis = emphasisLabels.join("、");
  return {
    id: "core-growth-quality",
    title: emphasis ? `增长、盈利质量与${emphasis}` : "增长与盈利质量",
    insight: emphasis
      ? `营收与利润率判断增长质量；${emphasis}按规则并入同一张图，单位相同即共用一条轴。`
      : "用营收规模与利润率共同判断增长是否带来更好的经营质量。",
    periodCount,
    series: merged,
  };
}

function buildOverridePlan(
  data: PublicFundamentalsResponse,
  override: FundamentalChartOverride,
  kind: "url" | "user",
): FundamentalChartPlan {
  if (!data.dataVersion) throw new Error("Cannot build an override plan without a data version.");
  const availableByKey = new Map(data.series.filter((series) => series.available).map((series) => [series.metricKey, series]));
  const candidates: FundamentalChartPlanSeries[] = override.metricKeys.flatMap((metricKey) => {
    const source = availableByKey.get(metricKey);
    if (!source) return [];
    return [{
      metricKey,
      // The mark is a property of the metric, not a user setting: currency
      // amounts read as bars and ratios as lines, so the catalog decides.
      mark: source.defaultMark,
      transform: "value" as const,
    }];
  }).slice(0, FUNDAMENTAL_CHART_MAX_SERIES);
  const series: FundamentalChartPlanSeries[] = [];
  for (const candidate of candidates) {
    try {
      buildFundamentalChartModel(data.periods, data.series, [...series, candidate]);
      series.push(candidate);
    } catch {
      // URL values can outlive catalog or unit changes. Keep every compatible
      // selection in order and deterministically omit only the invalid addition.
    }
  }
  const fallbackChart = series.length === 0
    ? buildDeterministicFundamentalChartPlan(data).charts[0]!
    : null;
  return {
    schemaVersion: FUNDAMENTAL_CHART_PLAN_SCHEMA_VERSION,
    ticker: data.ticker,
    inputDataHash: data.dataVersion,
    provenance: { kind },
    charts: fallbackChart
      ? [{ ...fallbackChart, id: `${kind}-view` }]
      : [{
          id: `${kind}-view`,
          title: "季度基本面叠加图",
          insight: "按报告期末对齐；不同颜色代表不同指标，单位不兼容时自动使用左右双轴。",
          periodCount: normalizePlanPeriodCount(override.periodCount),
          series,
        }],
  };
}

function normalizePlanPeriodCount(value: number): FundamentalChartPlanChart["periodCount"] {
  if (value >= 12) return 12;
  if (value >= 8) return 8;
  return 5;
}

function availableSeries(data: PublicFundamentalsResponse, metricKey: FundamentalMetricKey) {
  return data.series.find((series) => series.metricKey === metricKey)?.available === true;
}

function seriesValues(
  data: PublicFundamentalsResponse,
  metricKey: FundamentalMetricKey,
): Map<string, number> {
  const series = data.series.find((candidate) => candidate.metricKey === metricKey);
  return new Map(series?.points.flatMap((point) => {
    if (point.valueDecimal === null) return [];
    const value = Number(point.valueDecimal);
    return Number.isFinite(value) ? [[point.periodEnd, value] as const] : [];
  }) ?? []);
}

function alignedMagnitudeRatio(
  data: PublicFundamentalsResponse,
  numeratorKey: FundamentalMetricKey,
  denominatorKey: FundamentalMetricKey,
) {
  const numerator = seriesValues(data, numeratorKey);
  const denominator = seriesValues(data, denominatorKey);
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  for (const [periodEnd, denominatorValue] of denominator) {
    const numeratorValue = numerator.get(periodEnd);
    if (numeratorValue === undefined || denominatorValue === 0) continue;
    numeratorTotal += Math.abs(numeratorValue);
    denominatorTotal += Math.abs(denominatorValue);
  }
  return denominatorTotal === 0 ? null : roundFeature((numeratorTotal / denominatorTotal) * 100);
}

function alignedSignedRatio(
  data: PublicFundamentalsResponse,
  numeratorKey: FundamentalMetricKey,
  denominatorKey: FundamentalMetricKey,
) {
  const numerator = seriesValues(data, numeratorKey);
  const denominator = seriesValues(data, denominatorKey);
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  for (const [periodEnd, denominatorValue] of denominator) {
    const numeratorValue = numerator.get(periodEnd);
    if (numeratorValue === undefined || denominatorValue === 0) continue;
    numeratorTotal += numeratorValue;
    denominatorTotal += denominatorValue;
  }
  return denominatorTotal === 0 ? null : roundFeature((numeratorTotal / denominatorTotal) * 100);
}

function firstToLastChange(data: PublicFundamentalsResponse, metricKey: FundamentalMetricKey) {
  const values = [...seriesValues(data, metricKey).values()];
  return values.length < 2 ? null : roundFeature(values.at(-1)! - values[0]!);
}

function latestMagnitudeGrowth(data: PublicFundamentalsResponse, metricKey: FundamentalMetricKey) {
  const values = [...seriesValues(data, metricKey).values()].map(Math.abs);
  const previous = values.at(-2);
  const current = values.at(-1);
  if (previous === undefined || current === undefined || previous === 0) return null;
  return roundFeature(((current / previous) - 1) * 100);
}

function growthVolatility(data: PublicFundamentalsResponse, metricKey: FundamentalMetricKey) {
  const values = [...seriesValues(data, metricKey).values()];
  const growthRates: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    if (previous === 0) continue;
    growthRates.push(((values[index]! / previous) - 1) * 100);
  }
  if (growthRates.length < 2) return null;
  const average = growthRates.reduce((sum, value) => sum + value, 0) / growthRates.length;
  const variance = growthRates.reduce((sum, value) => sum + (value - average) ** 2, 0) / growthRates.length;
  return roundFeature(Math.sqrt(variance));
}

function checkUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: FundamentalChartPlanIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ code: "UNKNOWN_FIELD", path: `${path}.${key}`, message: `不允许字段 ${key}。` });
  }
}

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(issues: FundamentalChartPlanIssue[]): FundamentalChartPlanValidation {
  return { ok: false, plan: null, issues };
}

function roundFeature(value: number) {
  return Number(value.toFixed(2));
}
