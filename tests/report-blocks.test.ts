import assert from "node:assert/strict";
import test from "node:test";

import { makeChartResponse, makeChartSeries } from "./fixtures/fundamental-chart.ts";
import { REPORT_BLOCK_LIMITS, parseReportBlockDocument, type ReportBlockContext } from "../lib/web/report-blocks.ts";
import { REPORT_BLOCK_OUTPUT_SCHEMA } from "../shared/analysis-contract/report-blocks.ts";

const context: ReportBlockContext = {
  verifiedMetricKeys: new Set(["revenue", "operating_margin"]),
  fundamentals: makeChartResponse(),
};

function parse(sections: unknown, overrides: Partial<ReportBlockContext> = {}) {
  return parseReportBlockDocument({ sections }, { ...context, ...overrides });
}

test("a composed report keeps the sections and block types the page can render", () => {
  const { document, issues } = parse([
    {
      title: "本季要点",
      blocks: [
        { type: "prose", text: "云业务**同比 +18%**。" },
        { type: "key_points", points: [{ label: "收入", detail: "创新高。", importance: "high" }] },
        { type: "chart", title: "收入趋势", series: [{ metricKey: "total_revenue", mark: "bar", transform: "value" }] },
      ],
    },
  ]);
  assert.deepEqual(issues, []);
  assert.deepEqual(document.sections[0]!.blocks.map((block) => block.type), ["prose", "key_points", "chart"]);
});

test("an unknown block type is dropped with an issue rather than guessed at", () => {
  const { document, issues } = parse([{ title: "本季要点", blocks: [{ type: "video", src: "x" }, { type: "prose", text: "正文。" }] }]);
  assert.deepEqual(document.sections[0]!.blocks.map((block) => block.type), ["prose"]);
  assert.deepEqual(issues.map((issue) => issue.code), ["UNKNOWN_BLOCK_TYPE"]);
});

test("a metrics block may name only figures the Pipeline verified", () => {
  const { document, issues } = parse([{ title: "指标", blocks: [{ type: "metrics", metricKeys: ["revenue", "invented_metric"] }] }]);
  const block = document.sections[0]!.blocks[0]!;
  assert.equal(block.type === "metrics" && block.metricKeys.length, 1);
  assert.deepEqual(issues.map((issue) => issue.code), ["UNVERIFIED_METRIC"]);
});

test("a chart series is dropped when the fundamentals response cannot plot it", () => {
  const { issues } = parse(
    [{ title: "趋势", blocks: [{ type: "chart", title: "库存", series: [{ metricKey: "inventory" }] }] }],
    { fundamentals: makeChartResponse([makeChartSeries("total_revenue")]) },
  );
  // The series goes, then the chart, then the section that held nothing else.
  assert.deepEqual(issues.map((issue) => issue.code), ["UNAVAILABLE_METRIC", "EMPTY_BLOCK", "EMPTY_BLOCK"]);
});

test("a chart falls back to an allowed transform instead of honouring an invalid one", () => {
  const { document } = parse([{
    title: "趋势",
    blocks: [{ type: "chart", title: "收入", series: [{ metricKey: "total_revenue", transform: "cagr" }] }],
  }]);
  const block = document.sections[0]!.blocks[0]!;
  assert.equal(block.type === "chart" && block.series[0]!.transform, "value");
});

test("a section whose blocks all fail validation is dropped, not rendered as a bare heading", () => {
  const { document, issues } = parse([{ title: "空章节", blocks: [{ type: "prose", text: "   " }] }]);
  assert.deepEqual(document.sections, []);
  assert.deepEqual(issues.map((issue) => issue.code), ["EMPTY_BLOCK", "EMPTY_BLOCK"]);
});

test("every list is capped, so a runaway generation cannot lengthen the page without bound", () => {
  const { document } = parse(Array.from({ length: 40 }, () => ({
    title: "章节",
    blocks: [{ type: "key_points", points: Array.from({ length: 40 }, () => ({ label: "点", detail: "详情" })) }],
  })));
  assert.equal(document.sections.length, REPORT_BLOCK_LIMITS.sections);
  const block = document.sections[0]!.blocks[0]!;
  assert.equal(block.type === "key_points" && block.points.length, REPORT_BLOCK_LIMITS.keyPoints);
});

test("anchors come from position, not from the model, so a shared link survives regeneration", () => {
  const sections = [{ title: "要点", id: "model-picked", blocks: [{ type: "prose", id: "also-picked", text: "正文。" }] }];
  const { document } = parse(sections);
  assert.equal(document.sections[0]!.id, "report-section-1");
  assert.equal(document.sections[0]!.blocks[0]!.id, "report-block-1-1");
});

test("a report that is not a section list degrades to empty rather than throwing", () => {
  assert.deepEqual(parseReportBlockDocument("<html>", context).document.sections, []);
  assert.deepEqual(parseReportBlockDocument(null, context).issues.map((issue) => issue.code), ["INVALID_DOCUMENT"]);
});

/**
 * The prompt and the renderer are two halves of one vocabulary. This is the seam where they drift:
 * a block type added to the renderer but never described to the model is dead code, and one
 * described to the model but not rendered turns into a dropped block on every report.
 */
test("every block type the model is told about is a block the page can render", () => {
  const samples: Record<string, Record<string, unknown>> = {
    prose: { type: "prose", text: "正文。" },
    key_points: { type: "key_points", points: [{ label: "收入", detail: "创新高。" }] },
    metrics: { type: "metrics", metricKeys: ["revenue"] },
    chart: { type: "chart", title: "收入", series: [{ metricKey: "total_revenue" }] },
    evidence: { type: "evidence", items: [{ excerpt: "Revenue increased 18%.", start: 10, end: 40, score: 90 }] },
    callout: { type: "callout", tone: "caution", text: "含一次性项目。" },
  };
  const described = Object.keys(REPORT_BLOCK_OUTPUT_SCHEMA.blockTypes);
  assert.deepEqual(Object.keys(samples).sort(), described.sort(), "样例与告知模型的块类型不一致");
  const { document, issues } = parse(described.map((type) => ({ title: type, blocks: [samples[type]] })));
  assert.deepEqual(issues, []);
  assert.deepEqual(document.sections.flatMap((section) => section.blocks.map((block) => block.type)).sort(), described.sort());
});
