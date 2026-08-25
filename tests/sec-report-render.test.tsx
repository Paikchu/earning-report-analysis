import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SecReportDocument } from "../app/positions/[ticker]/sec/[accession]/SecReportDocument";
import type { SecFilingWithSummary } from "../lib/sec";

test("renders the complete report, dynamic evidence, and workflow trace", () => {
  const filing: SecFilingWithSummary = {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
    filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "0000789019-26-000001",
    primaryDocument: "msft.htm", description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
    summary: {
      ticker: "MSFT", form: "10-K", filingDate: "2026-07-30", accessionNumber: "0000789019-26-000001",
      headline: "云业务增长与资本投入同步加速",
      bullets: [
        { label: "收入", detail: "云业务继续推动收入增长。", importance: "high" },
        { label: "利润率", detail: "经营杠杆抵消部分投入压力。", importance: "medium" },
        { label: "现金流", detail: "资本开支仍是现金流关键变量。", importance: "medium" },
      ],
      analystView: "增长质量取决于投入转化效率。", report: "完整正文段落。", version: 5, source: "deepseek", generatedAt: "2026-08-10T00:00:00.000Z",
      nodes: [
        { id: "business-strategy", title: "业务与战略概览", status: "complete", findings: [], narrative: "梳理业务结构、竞争定位与战略投入。", evidence: [] },
        { id: "cloud-growth", title: "云业务增长", status: "complete", findings: [], narrative: "需求推动收入扩张。", evidence: [{ start: 10, end: 40, score: 90, reasons: ["包含定量数据"], excerpt: "Revenue increased 18%." }] },
      ],
      workflow: { version: 1, generatedAt: "2026-08-10T00:00:00.000Z", nodes: [{ id: "document", label: "正文获取", status: "complete", output: { summary: "正文已获取。" } }] },
    },
    analysis: {
      ticker: "MSFT", periodId: "MSFT:2026-06-30:annual", reportVersion: "sec-analysis.v2:test", headline: "云业务增长与资本投入同步加速",
      keyMetrics: [{ metricKey: "revenue", currentValue: "$120m", yoy: "+18.0%", status: "verified", evidenceIds: [] }],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] }, dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
    },
  };

  const html = renderToStaticMarkup(<SecReportDocument companyName="Microsoft Corp" filing={filing} />);

  assert.match(html, /核心结论/);
  assert.match(html, /验证指标/);
  assert.match(html, /完整正文/);
  assert.match(html, /动态分段分析/);
  assert.match(html, /数据质量/);
  assert.match(html, /全部 Workflow 节点/);
  assert.match(html, /Revenue increased 18%/);
  assert.match(html, /<details/);
  assert.match(html, /aria-label="报告目录"/);
  assert.match(html, /href="#sec-report-conclusions"/);
  assert.match(html, /href="#sec-report-node-1"/);
  assert.match(html, /data-report-title="业务与战略概览"/);
  assert.match(html, /data-report-depth="1"/);
  assert.match(html, /梳理业务结构、竞争定位与战略投入。/);
  assert.match(html, /data-report-title="核心结论"/);
  assert.match(html, /data-report-description="先看经营结果、主要驱动和对投资判断的直接含义。"/);
  assert.equal((html.match(/data-report-section="true"/g) ?? []).length, 6);
  assert.deepEqual([...html.matchAll(/data-report-index="(\d{2})"/g)].map((match) => match[1]), ["01", "02", "03", "04", "05", "06"]);
  assert.match(html, /data-report-rail-density="compact"/);
  assert.match(html, /class="fixed left-0 top-1\/2/);
  assert.match(html, /max-h-\[52dvh\] w-10/);
  assert.equal((html.match(/data-report-nav-depth="section"/g) ?? []).length, 6);
  assert.equal((html.match(/data-report-nav-depth="subsection"/g) ?? []).length, 2);
  assert.equal((html.match(/data-report-bar-state="resting"/g) ?? []).length, 8);
  assert.equal((html.match(/h-\[2px\] w-8 origin-left scale-x-\[\.38\] opacity-30/g) ?? []).length, 8);
});
