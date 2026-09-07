/**
 * The block protocol for a model-composed analysis.
 *
 * A published report used to be a fixed set of sections, so a filing with three interesting things
 * to say and one with ten rendered the same shape. A block list lets the analysis decide how many
 * pieces it needs and which form each one takes, while the reader-facing vocabulary stays closed:
 * the model picks from these types and nothing else, and every renderer lives in the Web service.
 *
 * No block carries a rendered value. `metrics` and `chart` name what to show and the page resolves
 * the numbers from data that already passed verification, so a block can never put a figure on the
 * page that the Pipeline did not verify — the same split `FundamentalChartSpec` already uses.
 *
 * A chart series reuses the fundamentals vocabulary rather than restating it, so a metric retired
 * there stops type-checking here. SEC metric keys are a separate, open vocabulary and stay strings.
 */
import type {
  FundamentalChartMark,
  FundamentalMetricKey,
  FundamentalTransform,
} from "./fundamentals.ts";

export const REPORT_BLOCK_SCHEMA_VERSION = "report-block.v1";

export type ReportBlockTone = "neutral" | "positive" | "negative" | "caution";

export type ReportBlockImportance = "high" | "medium" | "low";

/** Prose. Rendered through the rich-text subset, so light markup survives and HTML never does. */
export type ReportProseBlock = {
  type: "prose";
  id: string;
  title?: string;
  text: string;
};

export type ReportKeyPointsBlock = {
  type: "key_points";
  id: string;
  title?: string;
  points: Array<{ label: string; detail: string; importance: ReportBlockImportance }>;
};

/** Names verified metrics to surface; the page supplies every value and comparison. */
export type ReportMetricsBlock = {
  type: "metrics";
  id: string;
  title?: string;
  metricKeys: string[];
};

/**
 * Names series to plot. Points come from the fundamentals response, never from the model.
 *
 * There is no axis here on purpose. An explicitly requested side was the only way a chart could
 * reach `AXIS_CONFLICT` in the renderer, and the model has no information the renderer lacks —
 * sides are assigned from unit families, which it knows and the model is guessing at.
 */
export type ReportChartBlock = {
  type: "chart";
  id: string;
  title: string;
  caption?: string;
  periodCount?: number;
  series: Array<{
    metricKey: FundamentalMetricKey;
    mark?: FundamentalChartMark;
    transform?: FundamentalTransform;
  }>;
};

/** Filing excerpts with their character offsets, so a claim can be checked against the source. */
export type ReportEvidenceBlock = {
  type: "evidence";
  id: string;
  title?: string;
  items: Array<{ excerpt: string; start: number; end: number; score: number }>;
};

/** A framed aside: a caveat, an accounting change, a risk worth separating from the narrative. */
export type ReportCalloutBlock = {
  type: "callout";
  id: string;
  tone: ReportBlockTone;
  title?: string;
  text: string;
};

export type ReportBlock =
  | ReportProseBlock
  | ReportKeyPointsBlock
  | ReportMetricsBlock
  | ReportChartBlock
  | ReportEvidenceBlock
  | ReportCalloutBlock;

export type ReportBlockType = ReportBlock["type"];

/**
 * A composed section. `blocks` is variable in length and in composition; `navigable` marks the
 * sections that belong in the report's table of contents.
 */
export type ReportBlockSection = {
  id: string;
  title: string;
  description?: string;
  navigable: boolean;
  blocks: ReportBlock[];
};

export type ReportBlockDocument = {
  schemaVersion: typeof REPORT_BLOCK_SCHEMA_VERSION;
  sections: ReportBlockSection[];
};

/**
 * The vocabulary as the model is told it, injected into the analysis payload's `outputSchema` the
 * way `summarizePreparedSecEvent` already does. It lives beside the types rather than inside the
 * prompt so a block type cannot be added to one and forgotten in the other; a test asserts the
 * renderer accepts every type named here and nothing beyond it.
 *
 * Each entry says when to reach for the block, not only what shape it takes. A model picking the
 * wrong block is far more common than one writing malformed JSON, and shape alone does not tell it
 * that a single-period figure belongs in `metrics` while a trend belongs in `chart`.
 */
export const REPORT_BLOCK_OUTPUT_SCHEMA = {
  sections: "[{title, description?, navigable?, blocks}]：章节数由内容决定，2–12 个。navigable:false 的章节不进目录。",
  blocks: "每个 section 的 blocks 是下列块的任意组合，1–12 个。顺序即阅读顺序。",
  blockTypes: {
    prose: "{type:'prose', title?, text}：连续叙述。text 可用 **加粗**、`代码`、- 列表、### 小标题；不得写 HTML。用来解释因果，不要用它罗列数字。",
    key_points: "{type:'key_points', title?, points:[{label, detail, importance:'high'|'medium'|'low'}]}：并列要点 1–10 条，每条一个论断。不要把一段连贯叙述拆成要点。",
    metrics: "{type:'metrics', title?, metricKeys}：单期数值，最多 6 个，只能取自 payload 的 verifiedMetricKeys。不要写数值，页面从已验证数据里填。",
    chart: "{type:'chart', title, caption?, series:[{metricKey, mark?, transform?}]}：跨期趋势或对比，最多 4 条序列，metricKey 只能取自 payload 的 availableChartMetrics。不要写数据点，页面从基本面数据里填。单期数值用 metrics，不要用图。",
    evidence: "{type:'evidence', title?, items:[{excerpt, start, end, score}]}：原文摘录，excerpt 必须逐字来自 filing，start/end 是它在原文中的字符位置。",
    callout: "{type:'callout', tone:'neutral'|'positive'|'negative'|'caution', title?, text}：需要与叙述分开的口径变化、一次性项目或风险提示。",
  },
  rules: [
    "只使用上列 type，不要发明新的块类型：无法识别的块会被整块丢弃。",
    "metrics 与 chart 一律不写数值，只命名要展示什么。",
    "metricKey 只能取自 payload 给出的清单；凭印象写的指标名会被丢弃，那个块可能因此变空。",
    "没有材料支撑就不要产出该块。空块会连同它所在的章节一起被丢弃，宁可少一块。",
  ],
} as const;

export type ReportBlockOutputSchema = typeof REPORT_BLOCK_OUTPUT_SCHEMA;
