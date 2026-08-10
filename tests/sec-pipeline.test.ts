import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePreparedSecNode,
  analyzePreparedSecModule,
  discoverSecTicker,
  planPreparedSecFiling,
  prepareSecFiling,
  routePreparedSecFiling,
  selectWorkflowFilings,
  summarizePreparedSecEvent,
  summarizePreparedSecFiling,
  type SecModelCall,
} from "../lib/sec-pipeline.ts";
import { SEC_ANALYSIS_MODULES } from "../lib/sec-analysis.ts";
import type { SecAnalysisContext } from "../lib/sec-service.ts";
import { SEC_SUMMARY_VERSION, type SecFiling } from "../lib/sec.ts";

const filing: SecFiling = {
  ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
  filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "annual", primaryDocument: "msft.htm",
  description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
};

const completeReport = () => "本期经营结果体现出核心业务需求、收入质量、利润率、现金流与资本投入之间的联动。".repeat(24);
const completeBullets = () => [
  { label: "收入", detail: "收入达到 1.2 亿美元。", importance: "high" },
  { label: "利润率", detail: "利润率变化已完成验证。", importance: "medium" },
  { label: "现金流", detail: "现金流与资本投入需要联合观察。", importance: "medium" },
];

test("selects the newest periodic filing plus visible event filings", () => {
  const filings: SecFiling[] = [
    filing,
    { ...filing, form: "8-K", accessionNumber: "support", primaryDocument: "support.htm" },
    { ...filing, form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-04-29", accessionNumber: "older", primaryDocument: "older.htm" },
  ];

  assert.deepEqual(selectWorkflowFilings(filings).map((item) => item.accessionNumber), ["annual", "support"]);
});

test("keeps 8-K and 6-K on the compact event-summary contract", async () => {
  const event = { ...filing, form: "8-K", accessionNumber: "event", items: "2.02", description: "Results of Operations" };
  const prepared = await prepareSecFiling(event, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Item 2.02 Results of Operations</h1><p>Revenue increased 18% to $120 million.</p>"),
  });
  let payload: unknown;

  const summary = await summarizePreparedSecEvent(prepared, async (stage, system, input) => {
    assert.equal(stage, "event-summary");
    assert.match(system, /事件本身/);
    payload = input;
    return {
      headline: "收入增长事件已披露",
      bullets: completeBullets(),
      analystView: "事件改善了本期增长可见度。",
    };
  }, new Date("2026-08-10T00:00:00.000Z"));

  assert.equal(summary.form, "8-K");
  assert.equal(summary.report, undefined);
  assert.equal(summary.version, undefined);
  assert.match(JSON.stringify(payload), /Revenue increased 18%/);
});

test("discovers SEC filings without invoking an analysis model", async () => {
  const urls: string[] = [];
  const result = await discoverSecTicker("MSFT", {
    userAgent: "test@example.com",
    now: () => new Date("2026-08-05T00:00:00.000Z"),
    fetcher: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("company_tickers_exchange")) return Response.json({ fields: ["cik", "name", "ticker"], data: [[789019, "Microsoft Corp", "MSFT"]] });
      return Response.json({ name: "Microsoft Corp", filings: { recent: {
        accessionNumber: ["annual"], form: ["10-K"], filingDate: ["2026-07-30"], reportDate: ["2026-06-30"],
        primaryDocument: ["msft.htm"], primaryDocDescription: ["Annual report"], items: [""],
      } } });
    },
  });

  assert.equal(result.feed.status, "ready");
  assert.deepEqual(result.filings.map((item) => item.accessionNumber), ["annual"]);
  assert.equal(urls.some((url) => url.includes("deepseek")), false);
});

test("lets the manager plan a variable node graph from headings without seeing filing text", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response(`
      <h1>Item 7. Management's Discussion and Analysis</h1>
      <p>Revenue was $120 million.</p>
      <h1>Item 8. Financial Statements</h1>
      <p>Operating cash flow was $80 million.</p>
      <h1>Item 1A. Risk Factors</h1>
      <p>Demand may decline.</p>
    `),
  });
  let managerPayload: unknown;
  const plan = await planPreparedSecFiling(prepared, async (stage, _system, payload) => {
    assert.equal(stage, "manager");
    managerPayload = payload;
    return {
      nodes: prepared.outline.map((section, index) => ({
        id: `topic-${index + 1}`,
        title: `主题 ${index + 1}`,
        question: "本期发生了什么变化？",
        sectionIds: [section.id],
        keywords: ["revenue"],
      })),
    };
  });

  assert.equal(plan.nodes.length, prepared.outline.length);
  assert.ok(plan.nodes.length >= 3);
  assert.doesNotMatch(JSON.stringify(managerPayload), /\$120 million|Operating cash flow was/);
});

test("isolates a failed dynamic node while preserving completed node analysis", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Revenue</h1><p>Revenue increased 18% to $120 million, driven by cloud demand.</p>"),
  });
  const sectionId = prepared.outline[0].id;
  const complete = await analyzePreparedSecNode(prepared, {
    id: "revenue-growth",
    title: "收入增长",
    question: "收入增长由什么驱动？",
    sectionIds: [sectionId],
    keywords: ["revenue", "cloud demand"],
  }, async (stage, _system, payload) => {
    assert.equal(stage, "node:revenue-growth");
    assert.match(JSON.stringify(payload), /Revenue increased 18%/);
    return {
      findings: [{ label: "收入", detail: "收入增长 18%。", importance: "high" }],
      narrative: "云需求推动本期收入增长。",
    };
  });
  const failed = await analyzePreparedSecNode(prepared, {
    id: "risk-review",
    title: "风险变化",
    question: "风险发生了什么变化？",
    sectionIds: [sectionId],
    keywords: ["risk"],
  }, async () => { throw new Error("DeepSeek node HTTP 500"); });

  assert.equal(complete.status, "complete");
  assert.equal(complete.findings[0].label, "收入");
  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /HTTP 500/);
});

test("synthesizes one full report from node outputs and verified structured data without raw filing text", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Revenue</h1><p>RAW-FILING-MARKER revenue was $120 million.</p>"),
  });
  const context: SecAnalysisContext = {
    currentPeriodId: prepared.periodId,
    qoqPeriodId: null,
    yoyPeriodId: null,
    qoq: {},
    yoy: {},
    activeMemory: [],
  };
  const modules = SEC_ANALYSIS_MODULES.map((module) => ({
    moduleKey: module.key,
    facts: module.key === "performance" ? [{
      metricKey: "revenue",
      value: "120",
      unit: "USDm",
      basis: "gaap" as const,
      evidenceIds: [`ev:${prepared.blocks[0].blockId}`],
      confidence: "high" as const,
      sourceLabel: "fact_source_reported" as const,
    }] : [],
    claims: [],
    memoryCandidates: [],
    missingFields: [],
    evidenceCoverage: 1,
    verificationStatus: "verified" as const,
  }));
  const plan = normalizePlan(prepared.outline[0].id);
  const nodes = [{
    id: "revenue-growth",
    title: "收入增长",
    status: "complete" as const,
    findings: [{ label: "收入", detail: "收入达到 1.2 亿美元。", importance: "high" as const }],
    narrative: "收入增长由核心业务需求推动。",
    evidence: [],
  }];
  let synthesisPayload: unknown;
  const result = await summarizePreparedSecFiling(
    prepared,
    context,
    { selections: [], source: "fallback", status: "partial", missingModules: [] },
    modules,
    async (stage, _system, payload) => {
      assert.equal(stage, "synthesis");
      synthesisPayload = payload;
      return {
        headline: "核心业务推动收入增长",
        bullets: completeBullets(),
        analystView: "增长质量取决于需求能否延续。",
        report: completeReport(),
        keyMetrics: [{ metricKey: "revenue", currentValue: "120", evidenceIds: [`ev:${prepared.blocks[0].blockId}`] }],
        changes: { qoq: [], yoy: [], guidance: [], risks: [] },
        dataQuality: { coverage: 1, warnings: [] },
      };
    },
    new Date("2026-08-05T00:00:00.000Z"),
    plan,
    nodes,
  );

  assert.equal(result.summary.version, SEC_SUMMARY_VERSION);
  assert.match(result.summary.report ?? "", /核心业务需求/);
  assert.equal(result.summary.nodes?.length, 1);
  assert.doesNotMatch(JSON.stringify(synthesisPayload), /RAW-FILING-MARKER/);
});

function normalizePlan(sectionId: string) {
  return {
    nodes: [{
      id: "revenue-growth",
      title: "收入增长",
      question: "收入增长由什么驱动？",
      sectionIds: [sectionId],
      keywords: ["revenue"],
    }],
    outlineSections: 1,
  };
}

test("runs routing, module extraction and full synthesis as separate operations", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Item 8. Financial Statements</h1><p>Revenue was 120 USDm.</p>"),
  });
  const context: SecAnalysisContext = {
    currentPeriodId: prepared.periodId,
    qoqPeriodId: null,
    yoyPeriodId: null,
    qoq: {},
    yoy: {},
    activeMemory: [],
  };
  const calls: string[] = [];
  const model: SecModelCall = async (stage, _system, payload) => {
    calls.push(stage);
    if (stage === "router") {
      return { selections: SEC_ANALYSIS_MODULES.map((module) => ({ moduleKey: module.key, blockIds: [prepared.blocks[0].blockId], confidence: 1 })) };
    }
    if (stage.startsWith("module:")) {
      const current = payload as { current: { evidence: Array<{ evidenceId: string }> } };
      return {
        facts: [{ metricKey: "revenue", value: "120", unit: "USDm", basis: "gaap", sourceLabel: "fact_source_reported", evidenceIds: [current.current.evidence[0].evidenceId], confidence: "high" }],
        claims: [], memoryCandidates: [], missingFields: [], evidenceCoverage: 1,
      };
    }
    return {
      headline: "收入数据已验证",
      bullets: completeBullets(),
      analystView: "收入质量保持稳健。",
      report: completeReport(),
      keyMetrics: [{ metricKey: "revenue", currentValue: "120", evidenceIds: [`ev:${prepared.blocks[0].blockId}`] }],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, warnings: [] },
    };
  };

  const router = await routePreparedSecFiling(prepared, context, model);
  const modules = await Promise.all(SEC_ANALYSIS_MODULES.map((module) => analyzePreparedSecModule(module.key, prepared, context, router, model)));
  const plan = normalizePlan(prepared.outline[0].id);
  const nodes = [{
    id: "revenue-growth",
    title: "收入增长",
    status: "complete" as const,
    findings: [{ label: "收入", detail: "收入达到 1.2 亿美元。", importance: "high" as const }],
    narrative: "收入增长由核心业务需求推动。",
    evidence: [],
  }];
  const result = await summarizePreparedSecFiling(prepared, context, router, modules, model, new Date("2026-08-05T00:00:00.000Z"), plan, nodes);

  assert.equal(modules.every((module) => module.verificationStatus === "verified"), true);
  assert.equal(result.artifact.report.dataQuality.verificationStatus, "partial");
  assert.deepEqual(calls, ["router", ...SEC_ANALYSIS_MODULES.map((module) => `module:${module.key}`), "synthesis"]);
});

test("rejects a model-reported verified summary when module extraction found no facts", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Item 8. Financial Statements</h1><p>No usable values.</p>"),
  });
  const context: SecAnalysisContext = {
    currentPeriodId: prepared.periodId,
    qoqPeriodId: null,
    yoyPeriodId: null,
    qoq: {},
    yoy: {},
    activeMemory: [],
  };
  const modules = SEC_ANALYSIS_MODULES.map((module) => ({
    moduleKey: module.key,
    facts: [],
    claims: [],
    memoryCandidates: [],
    missingFields: [...module.fields],
    evidenceCoverage: 0,
    verificationStatus: "failed" as const,
  }));
  const result = await summarizePreparedSecFiling(
    prepared,
    context,
    { selections: [], source: "fallback", status: "failed", missingModules: SEC_ANALYSIS_MODULES.map((module) => module.key) },
    modules,
    async () => ({
      headline: "verified",
      bullets: completeBullets(),
      analystView: "验证结果有限。",
      report: completeReport(),
      keyMetrics: [],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
    }),
    new Date("2026-08-05T00:00:00.000Z"),
    normalizePlan(prepared.outline[0].id),
    [{
      id: "revenue-growth",
      title: "收入增长",
      status: "complete",
      findings: [{ label: "收入", detail: "收入已验证。", importance: "high" }],
      narrative: "收入分析。",
      evidence: [],
    }],
  );

  assert.equal(result.artifact.report.dataQuality.coverage, 0);
  assert.equal(result.artifact.report.dataQuality.verificationStatus, "failed");
});

test("rejects an incomplete synthesis before it can replace the last successful report", async () => {
  const prepared = await prepareSecFiling(filing, {
    userAgent: "test@example.com",
    fetcher: async () => new Response("<h1>Revenue</h1><p>Revenue increased 18%.</p>"),
  });
  const modules = SEC_ANALYSIS_MODULES.map((module) => ({
    moduleKey: module.key,
    facts: module.key === "performance" ? [{ metricKey: "revenue", value: "120", unit: "USDm", evidenceIds: [`ev:${prepared.blocks[0].blockId}`] }] : [],
    claims: [], memoryCandidates: [], missingFields: [], evidenceCoverage: 1, verificationStatus: "verified" as const,
  }));

  await assert.rejects(summarizePreparedSecFiling(
    prepared,
    { currentPeriodId: prepared.periodId, qoqPeriodId: null, yoyPeriodId: null, qoq: {}, yoy: {}, activeMemory: [] },
    { selections: [], source: "fallback", status: "partial", missingModules: [] },
    modules,
    async () => ({
      headline: "收入增长",
      bullets: [{ label: "收入", detail: "收入增长。", importance: "high" }],
      analystView: "需求仍需观察。",
      report: "正文过短。",
      keyMetrics: [], changes: { qoq: [], yoy: [], guidance: [], risks: [] }, dataQuality: { coverage: 1, warnings: [] },
    }),
    new Date("2026-08-05T00:00:00.000Z"),
    normalizePlan(prepared.outline[0].id),
    [{ id: "revenue-growth", title: "收入增长", status: "complete", findings: [], narrative: "收入增长。", evidence: [] }],
  ), /900.*1,600|核心结论/);
});
