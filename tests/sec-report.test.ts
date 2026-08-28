import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecNodeInput,
  buildSecOutline,
  normalizeSecNodePlan,
  normalizeSecNodeResult,
  type SecOutlineSection,
} from "../lib/sec-report.ts";
import type { SecNodeSpec } from "../lib/sec.ts";

/** The Manager always fills these; a test only spells out the parts it exercises. */
function nodeSpec(spec: Pick<SecNodeSpec, "id" | "title" | "question" | "sectionIds"> & Partial<SecNodeSpec>): SecNodeSpec {
  return { historySeriesIds: [], memoryIds: [], acceptanceCriteria: [], materiality: "high", ...spec };
}

test("drops duplicated table-of-contents headings and keeps the later real section", () => {
  const tocTitle = "Item 7. Management's Discussion and Analysis";
  const realTitle = tocTitle;
  const text = `${tocTitle}\nTable of contents entry.\n${"x".repeat(1_000)}\n${realTitle}\nRevenue increased 18%.`;
  const first = text.indexOf(tocTitle);
  const second = text.lastIndexOf(realTitle);

  const outline = buildSecOutline({
    text,
    headings: [
      { title: tocTitle, level: 2, start: first },
      { title: realTitle, level: 2, start: second },
    ],
  });

  assert.equal(outline.length, 1);
  assert.equal(outline[0].start, second);
  assert.equal(outline[0].title, realTitle);
});

test("uses one whole-document outline section when a filing has no recoverable headings", () => {
  const outline = buildSecOutline({ text: "Revenue increased 18%.", headings: [] });

  assert.deepEqual(outline, [{
    id: "document",
    title: "Full document",
    level: 1,
    start: 0,
    end: 22,
    characters: 22,
  }]);
});

test("keeps however many valid analysis nodes the manager planned", () => {
  const outline: SecOutlineSection[] = Array.from({ length: 9 }, (_, index) => ({
    id: `section-${index + 1}`,
    title: `Section ${index + 1}`,
    level: 2,
    start: index * 100,
    end: (index + 1) * 100,
    characters: 100,
  }));
  const managerOutput = (count: number) => ({
    nodes: outline.slice(0, count).map((section, index) => ({
      id: `topic-${index + 1}`,
      title: `主题 ${index + 1}`,
      question: `第 ${index + 1} 个主题发生了什么变化？`,
      sectionIds: [section.id],
      keywords: ["revenue"],
    })),
  });

  assert.equal(normalizeSecNodePlan(managerOutput(3), outline).nodes.length, 3);
  assert.equal(normalizeSecNodePlan(managerOutput(9), outline).nodes.length, 9);
});

test("filters invented sections, makes step ids unique, and records node clamping", () => {
  const outline: SecOutlineSection[] = [{ id: "real", title: "Revenue", level: 2, start: 0, end: 100, characters: 100 }];
  const nodes = Array.from({ length: 27 }, (_, index) => ({
    id: "Revenue",
    title: `收入主题 ${index + 1}`,
    question: "收入为什么变化？",
    sectionIds: index === 0 ? ["invented"] : ["real", "invented"],
    keywords: ["Revenue", "revenue", "net sales"],
  }));

  const plan = normalizeSecNodePlan({ nodes }, outline);

  assert.equal(plan.nodes.length, 24);
  assert.equal(plan.clamped, 2);
  assert.equal(plan.nodes[0].id, "revenue");
  assert.equal(plan.nodes[1].id, "revenue-2");
  assert.deepEqual(plan.nodes[0].sectionIds, ["real"]);
  assert.deepEqual(plan.nodes[0].keywords, ["revenue", "net sales"]);
});

test("compresses oversized node sections while preserving quantitative driver evidence", () => {
  const filler = Array.from({ length: 140 }, (_, index) => `General discussion paragraph ${index} without useful detail.`).join("\n");
  const decisive = "Cloud revenue increased 22% to $50,000 million, primarily driven by Azure demand.";
  const text = `${filler}\n${decisive}\n${filler}`;
  const outline: SecOutlineSection[] = [{ id: "results", title: "Results of Operations", level: 2, start: 0, end: text.length, characters: text.length }];

  const input = buildSecNodeInput(nodeSpec({
    id: "cloud-growth",
    title: "云业务增长",
    question: "云业务增长由什么驱动？",
    sectionIds: ["results"],
    keywords: ["cloud revenue", "azure", "demand"],
  }), outline, text);

  assert.ok(input.characters <= 12_000);
  assert.equal(input.sections[0].compressed, true);
  assert.match(input.sections[0].text, /Cloud revenue increased 22%/);
  assert.ok(input.evidence.some((item) => item.excerpt.includes("Cloud revenue increased 22%")));
  assert.ok(input.evidence.every((item) => text.slice(item.start, item.end).length > 0));
});

test("records located evidence for a node even when its bound section is not compressed", () => {
  const text = "Revenue increased 18% to $120 million, driven by cloud demand.";
  const outline: SecOutlineSection[] = [{ id: "results", title: "Results of Operations", level: 2, start: 0, end: text.length, characters: text.length }];

  const input = buildSecNodeInput(nodeSpec({
    id: "growth",
    title: "增长",
    question: "收入由什么驱动？",
    sectionIds: ["results"],
    keywords: ["revenue", "cloud demand"],
  }), outline, text);

  assert.equal(input.sections[0].compressed, false);
  assert.equal(input.evidence.length, 1);
  assert.equal(text.slice(input.evidence[0].start, input.evidence[0].end), input.evidence[0].excerpt);
  assert.ok(input.evidence[0].score > 0);
});

test("keeps one node below the 12,000-character guardrail across many sections", () => {
  const bodies = Array.from({ length: 18 }, (_, index) => `Section ${index + 1}\n${"revenue and demand context ".repeat(36)}`);
  const text = bodies.join("\n");
  let start = 0;
  const outline = bodies.map((body, index): SecOutlineSection => {
    const section = { id: `section-${index + 1}`, title: `Section ${index + 1}`, level: 2, start, end: start + body.length, characters: body.length };
    start += body.length + 1;
    return section;
  });

  const input = buildSecNodeInput(nodeSpec({
    id: "many-sections",
    title: "跨章节分析",
    question: "多个章节共同说明了什么？",
    sectionIds: outline.map((section) => section.id),
    keywords: ["revenue", "demand"],
  }), outline, text);

  assert.equal(input.sections.length, 18);
  assert.ok(input.characters <= 12_000);
});

test("normalizes one completed node without changing its manager-owned identity", () => {
  const result = normalizeSecNodeResult({
    findings: [{ label: "收入", detail: "云收入同比增长 22%。", importance: "high" }],
    narrative: "云业务保持增长。\n\n需求仍是主要驱动。",
  }, nodeSpec({
    id: "cloud-growth",
    title: "云业务增长",
    question: "云业务增长由什么驱动？",
    sectionIds: ["results"],
  }), [{ start: 10, end: 40, score: 92, reasons: ["包含定量数据"], excerpt: "Cloud revenue increased 22%." }]);

  assert.equal(result.id, "cloud-growth");
  assert.equal(result.title, "云业务增长");
  assert.equal(result.status, "complete");
  assert.equal(result.findings[0].importance, "high");
  assert.match(result.narrative, /需求仍是主要驱动/);
  assert.equal(result.evidence[0].score, 92);
});

test("drops memory ids the brief never contained and says so in the plan warnings", () => {
  const outline: SecOutlineSection[] = [{ id: "results", title: "Results", level: 2, start: 0, end: 100, characters: 100 }];
  const nodes = [{
    id: "growth", title: "增长", question: "增长由什么驱动？", sectionIds: ["results"],
    historySeriesIds: ["revenue", "bookings"], memoryIds: ["memory:real", "memory:invented"],
  }];

  const plan = normalizeSecNodePlan({ nodes }, outline, new Set(["memory:real"]));

  assert.deepEqual(plan.nodes[0].memoryIds, ["memory:real"]);
  assert.deepEqual(plan.nodes[0].historySeriesIds, ["revenue"]);
  assert.ok(plan.warnings?.some((warning) => warning.includes("memory:invented")));
  assert.ok(plan.warnings?.some((warning) => warning.includes("bookings")));
});

test("warns when company memory exists but the manager assigned none of it", () => {
  const outline: SecOutlineSection[] = [{ id: "results", title: "Results", level: 2, start: 0, end: 100, characters: 100 }];
  const nodes = [{ id: "growth", title: "增长", question: "增长由什么驱动？", sectionIds: ["results"], memoryIds: [] }];

  const assigned = normalizeSecNodePlan({ nodes }, outline, new Set());
  const ignored = normalizeSecNodePlan({ nodes }, outline, new Set(["memory:real"]));
  const unchecked = normalizeSecNodePlan({ nodes }, outline);

  assert.equal(assigned.warnings, undefined);
  assert.ok(ignored.warnings?.some((warning) => warning.includes("no planned node picked any of it up")));
  assert.equal(unchecked.warnings, undefined);
});

test("keeps memory verdicts only for assigned memory backed by node evidence", () => {
  const spec = nodeSpec({
    id: "guidance", title: "指引", question: "上期指引兑现了吗？", sectionIds: ["results"],
    memoryIds: ["memory:guidance", "memory:risk"],
  });
  const validEvidenceIds = new Set(["ev:block-1"]);

  const result = normalizeSecNodeResult({
    findings: [{ label: "指引", detail: "本期收入指引上修。", importance: "high" }],
    narrative: "上期的收入指引本期兑现。",
    memoryChecks: [
      { memoryId: "memory:guidance", verdict: "confirmed", note: "收入超过指引区间上限。", evidenceIds: ["block-1"] },
      { memoryId: "memory:risk", verdict: "not_addressed", note: "本节未涉及。", evidenceIds: [] },
      { memoryId: "memory:guidance", verdict: "contradicted", note: "重复条目。", evidenceIds: ["ev:block-1"] },
      { memoryId: "memory:unassigned", verdict: "confirmed", note: "未分配给本节。", evidenceIds: ["ev:block-1"] },
      { memoryId: "memory:risk", verdict: "contradicted", note: "没有证据的断言。", evidenceIds: ["ev:missing"] },
    ],
  }, spec, [], validEvidenceIds);

  assert.deepEqual(result.memoryChecks?.map((check) => [check.memoryId, check.verdict]), [
    ["memory:guidance", "confirmed"],
    ["memory:risk", "not_addressed"],
  ]);
  assert.deepEqual(result.memoryChecks?.[0].evidenceIds, ["ev:block-1"]);
});

test("omits memory verdicts entirely when the manager assigned no memory", () => {
  const result = normalizeSecNodeResult({
    narrative: "云业务保持增长。",
    memoryChecks: [{ memoryId: "memory:guidance", verdict: "confirmed", note: "", evidenceIds: ["ev:block-1"] }],
  }, nodeSpec({ id: "cloud", title: "云", question: "云增长如何？", sectionIds: ["results"] }), [], new Set(["ev:block-1"]));

  assert.equal(result.memoryChecks, undefined);
});
