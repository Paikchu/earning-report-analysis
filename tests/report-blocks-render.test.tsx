import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReportBlocks, type ReportBlockRenderContext } from "../components/report-blocks/ReportBlocks.tsx";
import { RichText } from "../components/rich-text/RichText.tsx";
import { makeChartResponse } from "./fixtures/fundamental-chart.ts";
import { parseReportBlockDocument } from "../lib/web/report-blocks.ts";

const context: ReportBlockRenderContext = {
  metrics: [{ metricKey: "revenue", currentValue: "$120m", yoy: "+18.0%", status: "verified", evidenceIds: [] }],
  fundamentals: makeChartResponse(),
};

function render(sections: unknown) {
  const { document } = parseReportBlockDocument({ sections }, {
    verifiedMetricKeys: new Set(context.metrics.map((metric) => metric.metricKey)),
    fundamentals: context.fundamentals,
  });
  return renderToStaticMarkup(<ReportBlocks context={context} document={document} />);
}

test("a report renders as many sections and blocks as the analysis composed", () => {
  const html = render([
    { title: "本季要点", blocks: [{ type: "key_points", points: [{ label: "收入", detail: "创新高。", importance: "high" }] }] },
    { title: "收入趋势", blocks: [{ type: "chart", title: "季度收入", caption: "口径：GAAP", series: [{ metricKey: "total_revenue" }] }] },
    { title: "口径提示", navigable: false, blocks: [{ type: "callout", tone: "caution", text: "本期含一次性项目。" }] },
  ]);
  assert.equal((html.match(/data-report-section="true"/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/data-report-index="(\d{2})"/g)].map((match) => match[1]), ["01", "02", "03"]);
  assert.match(html, /季度收入/);
  assert.match(html, /data-tone="caution"/);
  // The section the analysis marked unnavigable stays out of the contents panel.
  assert.equal((html.match(/data-report-nav-item="true"/g) ?? []).length, 2);
});

test("blocks resolve their numbers from verified data instead of carrying them", () => {
  const html = render([{ title: "指标", blocks: [{ type: "metrics", metricKeys: ["revenue"], title: "已验证" }] }]);
  assert.match(html, /\$120m/);
  assert.match(html, /同比 \+18\.0%/);
});

test("model prose reaches the page as text, never as markup", () => {
  const hostile = "<img src=x onerror=alert(1)> 与 <b>粗体</b>";
  const html = renderToStaticMarkup(<RichText text={hostile} />);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<b>"), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("light markup in prose becomes elements the page styles", () => {
  const html = renderToStaticMarkup(<RichText text={"### 指引\n云业务**同比 +18%**。\n- 收入创新高\n- 利润率承压"} />);
  assert.match(html, /<h3 class="rich-text-heading">指引<\/h3>/);
  assert.match(html, /<strong>同比 \+18%<\/strong>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
});

test("an empty composition renders nothing rather than an empty frame", () => {
  assert.equal(render([]), "");
  assert.equal(renderToStaticMarkup(<RichText text="   " />), "");
});
