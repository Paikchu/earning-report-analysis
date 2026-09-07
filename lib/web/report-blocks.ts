import {
  FUNDAMENTAL_CHART_MAX_SERIES,
} from "./fundamental-chart.ts";
import { isFundamentalMetricKey } from "./fundamental-metrics.ts";
import type {
  FundamentalChartMark,
  FundamentalTransform,
  PublicFundamentalsResponse,
} from "../../shared/analysis-contract/fundamentals.ts";
import {
  REPORT_BLOCK_SCHEMA_VERSION,
  type ReportBlock,
  type ReportChartBlock,
  type ReportBlockDocument,
  type ReportBlockImportance,
  type ReportBlockSection,
  type ReportBlockTone,
} from "../../shared/analysis-contract/report-blocks.ts";

/**
 * Deterministic validation of a model-composed report.
 *
 * The model chooses the shape of the report, so its output is untrusted structure: this narrows it
 * to the closed vocabulary the page can render, caps every list, and drops what it cannot resolve.
 * It mirrors `parseFundamentalChartPlan` — collect issues, keep the valid remainder, never throw —
 * because the failure that matters is a report that renders half of itself, not one that 500s.
 *
 * Nothing here trusts a number from the model. A `metrics` block survives only for keys the
 * Pipeline already verified, and a `chart` series only for a metric the fundamentals response
 * actually carries with that transform allowed.
 */

export type ReportBlockIssueCode =
  | "INVALID_DOCUMENT"
  | "UNKNOWN_BLOCK_TYPE"
  | "INVALID_BLOCK"
  | "EMPTY_BLOCK"
  | "UNVERIFIED_METRIC"
  | "UNAVAILABLE_METRIC";

export type ReportBlockIssue = { code: ReportBlockIssueCode; path: string; message: string };

export type ReportBlockContext = {
  /** Metric keys the Pipeline verified for this filing. A `metrics` block may name only these. */
  verifiedMetricKeys: ReadonlySet<string>;
  fundamentals: PublicFundamentalsResponse | null;
};

export const REPORT_BLOCK_LIMITS = {
  sections: 12,
  blocksPerSection: 12,
  keyPoints: 10,
  metricKeys: 6,
  evidenceItems: 8,
  chartSeries: FUNDAMENTAL_CHART_MAX_SERIES,
  proseLength: 4_000,
} as const;

const TONES = new Set<ReportBlockTone>(["neutral", "positive", "negative", "caution"]);
const IMPORTANCE = new Set<ReportBlockImportance>(["high", "medium", "low"]);
const MARKS = new Set<FundamentalChartMark>(["bar", "line"]);

export function parseReportBlockDocument(
  raw: unknown,
  context: ReportBlockContext,
): { document: ReportBlockDocument; issues: ReportBlockIssue[] } {
  const issues: ReportBlockIssue[] = [];
  const empty: ReportBlockDocument = { schemaVersion: REPORT_BLOCK_SCHEMA_VERSION, sections: [] };
  if (!isRecord(raw) || !Array.isArray(raw.sections)) {
    issues.push({ code: "INVALID_DOCUMENT", path: "$", message: "报告缺少 sections 数组。" });
    return { document: empty, issues };
  }
  // Anchors are shared as links, so an id is assigned by position rather than taken from the model,
  // which has no reason to keep one stable between regenerations of the same filing.
  const sections = raw.sections
    .slice(0, REPORT_BLOCK_LIMITS.sections)
    .map((section, index) => parseSection(section, index, `$.sections[${index}]`, context, issues))
    .filter((section): section is ReportBlockSection => section !== null);
  return { document: { schemaVersion: REPORT_BLOCK_SCHEMA_VERSION, sections }, issues };
}

function parseSection(
  raw: unknown,
  index: number,
  path: string,
  context: ReportBlockContext,
  issues: ReportBlockIssue[],
): ReportBlockSection | null {
  if (!isRecord(raw)) {
    issues.push({ code: "INVALID_BLOCK", path, message: "section 必须是 object。" });
    return null;
  }
  const title = text(raw.title, 120);
  if (!title || !Array.isArray(raw.blocks)) {
    issues.push({ code: "INVALID_BLOCK", path, message: "section 缺少 title 或 blocks。" });
    return null;
  }
  const blocks = raw.blocks
    .slice(0, REPORT_BLOCK_LIMITS.blocksPerSection)
    .map((block, order) => parseBlock(block, `${index + 1}-${order + 1}`, `${path}.blocks[${order}]`, context, issues))
    .filter((block): block is ReportBlock => block !== null);
  // A heading with nothing under it reads as a rendering failure, so the section goes with it.
  if (blocks.length === 0) {
    issues.push({ code: "EMPTY_BLOCK", path, message: `「${title}」没有可渲染的内容。` });
    return null;
  }
  return {
    id: `report-section-${index + 1}`,
    title,
    ...(text(raw.description, 200) ? { description: text(raw.description, 200) } : {}),
    navigable: raw.navigable !== false,
    blocks,
  };
}

function parseBlock(
  raw: unknown,
  id: string,
  path: string,
  context: ReportBlockContext,
  issues: ReportBlockIssue[],
): ReportBlock | null {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    issues.push({ code: "INVALID_BLOCK", path, message: "block 必须是带 type 的 object。" });
    return null;
  }
  const blockId = `report-block-${id}`;
  const title = text(raw.title, 120);
  const titled = title ? { title } : {};
  switch (raw.type) {
    case "prose": {
      const body = text(raw.text, REPORT_BLOCK_LIMITS.proseLength);
      if (!body) return drop(issues, "EMPTY_BLOCK", path, "prose 没有正文。");
      return { type: "prose", id: blockId, ...titled, text: body };
    }
    case "callout": {
      const body = text(raw.text, REPORT_BLOCK_LIMITS.proseLength);
      if (!body) return drop(issues, "EMPTY_BLOCK", path, "callout 没有正文。");
      const tone = typeof raw.tone === "string" && TONES.has(raw.tone as ReportBlockTone)
        ? raw.tone as ReportBlockTone
        : "neutral";
      return { type: "callout", id: blockId, tone, ...titled, text: body };
    }
    case "key_points": {
      const points = (Array.isArray(raw.points) ? raw.points : [])
        .slice(0, REPORT_BLOCK_LIMITS.keyPoints)
        .flatMap((point) => {
          if (!isRecord(point)) return [];
          const label = text(point.label, 40);
          const detail = text(point.detail, 400);
          if (!label && !detail) return [];
          const importance = typeof point.importance === "string" && IMPORTANCE.has(point.importance as ReportBlockImportance)
            ? point.importance as ReportBlockImportance
            : "medium";
          return [{ label, detail, importance }];
        });
      if (points.length === 0) return drop(issues, "EMPTY_BLOCK", path, "key_points 没有条目。");
      return { type: "key_points", id: blockId, ...titled, points };
    }
    case "metrics": {
      const requested = (Array.isArray(raw.metricKeys) ? raw.metricKeys : []).filter((key): key is string => typeof key === "string");
      const metricKeys = requested.filter((key) => context.verifiedMetricKeys.has(key)).slice(0, REPORT_BLOCK_LIMITS.metricKeys);
      for (const key of requested) {
        if (!context.verifiedMetricKeys.has(key)) {
          issues.push({ code: "UNVERIFIED_METRIC", path: `${path}.metricKeys`, message: `${key} 未通过验证，不予展示。` });
        }
      }
      if (metricKeys.length === 0) return drop(issues, "EMPTY_BLOCK", path, "metrics 没有已验证的指标。");
      return { type: "metrics", id: blockId, ...titled, metricKeys };
    }
    case "chart": {
      if (!title) return drop(issues, "INVALID_BLOCK", path, "chart 缺少 title。");
      const data = context.fundamentals;
      if (!data) return drop(issues, "UNAVAILABLE_METRIC", path, "当前没有可用的基本面数据。");
      const series = (Array.isArray(raw.series) ? raw.series : [])
        .slice(0, REPORT_BLOCK_LIMITS.chartSeries)
        .flatMap((entry) => parseChartSeries(entry, `${path}.series`, data, issues));
      if (series.length === 0) return drop(issues, "EMPTY_BLOCK", path, "chart 没有可绘制的序列。");
      return {
        type: "chart",
        id: blockId,
        title,
        ...(text(raw.caption, 200) ? { caption: text(raw.caption, 200) } : {}),
        ...(typeof raw.periodCount === "number" && Number.isInteger(raw.periodCount) ? { periodCount: raw.periodCount } : {}),
        series,
      };
    }
    case "evidence": {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .slice(0, REPORT_BLOCK_LIMITS.evidenceItems)
        .flatMap((item) => {
          if (!isRecord(item)) return [];
          const excerpt = text(item.excerpt, 1_200);
          if (!excerpt) return [];
          return [{
            excerpt,
            start: integer(item.start),
            end: integer(item.end),
            score: Math.min(100, Math.max(0, integer(item.score))),
          }];
        });
      if (items.length === 0) return drop(issues, "EMPTY_BLOCK", path, "evidence 没有摘录。");
      return { type: "evidence", id: blockId, ...titled, items };
    }
    default:
      // Forward compatibility runs one way: a page that predates a block type drops it rather than
      // guessing at a rendering, and the issue makes the gap visible instead of silent.
      return drop(issues, "UNKNOWN_BLOCK_TYPE", path, `不支持的 block 类型：${raw.type}`);
  }
}

function parseChartSeries(
  raw: unknown,
  path: string,
  data: PublicFundamentalsResponse,
  issues: ReportBlockIssue[],
): ReportChartBlock["series"] {
  if (!isRecord(raw) || typeof raw.metricKey !== "string" || !isFundamentalMetricKey(raw.metricKey)) {
    issues.push({ code: "INVALID_BLOCK", path, message: "series 的 metricKey 不合法。" });
    return [];
  }
  const source = data.series.find((series) => series.metricKey === raw.metricKey);
  if (!source?.available) {
    issues.push({ code: "UNAVAILABLE_METRIC", path, message: `当前数据没有 ${raw.metricKey}。` });
    return [];
  }
  const transform = typeof raw.transform === "string" && source.allowedTransforms.includes(raw.transform as FundamentalTransform)
    ? raw.transform as FundamentalTransform
    : source.allowedTransforms[0];
  if (!transform) {
    issues.push({ code: "UNAVAILABLE_METRIC", path, message: `${raw.metricKey} 没有可用的口径。` });
    return [];
  }
  const mark = typeof raw.mark === "string" && MARKS.has(raw.mark as FundamentalChartMark)
    ? raw.mark as FundamentalChartMark
    : source.defaultMark;
  return [{ metricKey: raw.metricKey, mark, transform }];
}

function drop(issues: ReportBlockIssue[], code: ReportBlockIssueCode, path: string, message: string): null {
  issues.push({ code, path, message });
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
