import assert from "node:assert/strict";
import test from "node:test";

import type { SecAnalysisArtifact, SecAnalysisContext } from "../lib/sec-service.ts";
import type { SecFiling, SecNodeSpec } from "../lib/sec.ts";
import { createSecPipelineOperations, type SecPipelineEnv } from "../workers/sec-cron/operations.ts";

const filing: SecFiling = {
  ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
  filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "annual", primaryDocument: "msft.htm",
  description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
};

test("module stages read compact R2 slices after routing instead of reparsing the full filing", async () => {
  const objects = new Map<string, string>();
  const bucket = {
    async get(key: string) {
      const value = objects.get(key);
      return value === undefined ? null : { async text() { return value; } };
    },
    async put(key: string, value: string) {
      objects.set(key, value);
      return {};
    },
  };
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_FILINGS: bucket,
  } as SecPipelineEnv;
  let modelCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === filing.documentUrl) {
      return new Response("<h1>Item 8. Financial Statements</h1><p>Revenue was 120 USDm.</p>");
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const payload = JSON.parse(body.messages?.[1]?.content ?? "{}") as { current?: { evidence?: Array<{ evidenceId: string }> } };
    if (modelCalls++ === 0) {
      const full = JSON.parse(objects.get("filings/MSFT/annual.json") ?? "{}") as { blocks?: Array<{ blockId: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{ moduleKey: "performance", blockIds: [full.blocks?.[0]?.blockId], confidence: 1 }] }) } }] });
    }
    const evidenceId = payload.current?.evidence?.[0]?.evidenceId;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [{ metricKey: "revenue", value: "120", unit: "USDm", evidenceIds: [evidenceId] }], evidenceCoverage: 1 }) } }] });
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const context: SecAnalysisContext = { currentPeriodId: "MSFT:2026-06-30:annual", qoqPeriodId: null, yoyPeriodId: null, qoq: {}, yoy: {}, activeMemory: [] };
  const reference = await operations.prepare(filing);
  const router = await operations.route(filing, reference, context);
  objects.delete(reference.key);

  const analysis = await operations.analyzeModule("performance", filing, reference, context, router);

  assert.equal(analysis.facts[0]?.metricKey, "revenue");
  assert.ok([...objects.keys()].some((key) => key.endsWith("/modules/performance.json")));
});

test("scheduled analysis does not overlap an already running filing job", async () => {
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
  } as SecPipelineEnv;
  const operations = createSecPipelineOperations(env, async () => Response.json({ status: "running" }));

  assert.equal(await operations.shouldAnalyze(filing, "scheduled"), false);
  assert.equal(await operations.shouldAnalyze(filing, "manual"), true);
});

test("calls B.ai from the workflow worker when its shared AI secret is configured", async () => {
  const objects = new Map<string, string>();
  const requests: string[] = [];
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_ANALYSIS_MODEL: "deepseek-v4-flash",
    SEC_FILINGS: {
      async get(key: string) {
        const value = objects.get(key);
        return value === undefined ? null : { async text() { return value; } };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
        return {};
      },
    },
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === filing.documentUrl) return new Response("<h1>Revenue</h1><p>Revenue was 120 USDm.</p>");
    if (url === "https://api.b.ai/v1/chat/completions") {
      const full = JSON.parse(objects.get("filings/MSFT/annual.json") ?? "{}") as { blocks?: Array<{ blockId: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{ moduleKey: "performance", blockIds: [full.blocks?.[0]?.blockId], confidence: 1 }] }) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const context: SecAnalysisContext = { currentPeriodId: "MSFT:2026-06-30:annual", qoqPeriodId: null, yoyPeriodId: null, qoq: {}, yoy: {}, activeMemory: [] };
  const reference = await operations.prepare(filing);

  await operations.route(filing, reference, context);

  assert.ok(requests.includes("https://api.b.ai/v1/chat/completions"));
  assert.equal(requests.some((url) => url.includes("/api/internal/sec/model")), false);
});

test("plans and runs dynamic nodes from the prepared R2 filing", async () => {
  const objects = new Map<string, string>();
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_FILINGS: {
      async get(key: string) {
        const value = objects.get(key);
        return value === undefined ? null : { async text() { return value; } };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
        return {};
      },
    },
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === filing.documentUrl) {
      return new Response("<h1>Item 7. Management Discussion</h1><p>Revenue increased 12% to $120 million due to cloud demand.</p>");
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const system = body.messages?.[0]?.content ?? "";
    if (system.includes("编排分析任务")) {
      const prepared = JSON.parse(objects.get("filings/MSFT/annual.json") ?? "{}") as { outline?: Array<{ id: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ nodes: [{ id: "growth", title: "增长质量", question: "增长由什么驱动？", sectionIds: [prepared.outline?.[0]?.id], keywords: ["revenue", "cloud"] }] }) } }] });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ findings: [{ label: "收入", detail: "收入同比增长12%。", importance: "high" }], narrative: "云需求推动收入增长。" }) } }] });
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const reference = await operations.prepare(filing);
  const plan = await operations.plan(filing, reference);
  const node = await operations.analyzeNode(plan.nodes[0] as SecNodeSpec, filing, reference);

  assert.equal(plan.nodes.length, 1);
  assert.equal(node.status, "complete");
  assert.match(node.narrative, /云需求/);
});

test("publishes cited evidence in bounded D1 bridge calls", async () => {
  const blocks = Array.from({ length: 20 }, (_, ordinal) => ({
    blockId: `block-${ordinal}`,
    ordinal,
    heading: "Financial Statements",
    headingPath: "Item 8",
    elementType: "paragraph" as const,
    preview: `Block ${ordinal}`,
    body: `Revenue evidence ${ordinal}`,
    tokenCount: 3,
    numericDensity: 0.2,
    tableCount: 0,
    contentHash: `hash-${ordinal}`,
  }));
  const citedBlocks = blocks.slice(0, 18);
  const prepared = {
    filing,
    periodId: "MSFT:2026-06-30:annual",
    periodScope: "annual" as const,
    blocks,
    document: { text: blocks.map((block) => block.body).join("\n"), headings: [] },
    outline: [],
  };
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: {
      async get(key: string) {
        return key === "filings/MSFT/annual.json" ? { async text() { return JSON.stringify(prepared); } } : null;
      },
      async put() { return {}; },
    },
  } as SecPipelineEnv;
  const facts = citedBlocks.map((block, index) => ({
    metricKey: `metric_${index}`,
    value: String(index),
    unit: "USDm",
    basis: "gaap" as const,
    evidenceIds: [`ev:${block.blockId}`],
    confidence: "high" as const,
    sourceLabel: "fact_source_reported" as const,
  }));
  const snapshot = {
    ticker: "MSFT",
    periodId: prepared.periodId,
    filingId: filing.accessionNumber,
    moduleKey: "performance" as const,
    facts,
    claims: [],
    memoryCandidates: [],
    missingFields: [],
    evidenceCoverage: 1,
    verificationStatus: "verified" as const,
  };
  const artifact = {
    filing,
    periodId: prepared.periodId,
    periodScope: prepared.periodScope,
    blocks: [],
    moduleAnalyses: [snapshot],
    snapshots: [snapshot],
    comparisons: [],
    memoryCandidates: [],
    router: { selections: [], source: "fallback" as const, status: "complete" as const, missingModules: [] },
    report: {
      ticker: "MSFT",
      periodId: prepared.periodId,
      reportVersion: "v1",
      headline: "verified",
      keyMetrics: [{ metricKey: "revenue", currentValue: "331839", status: "verified" as const, evidenceIds: citedBlocks.map((block) => `ev:${block.blockId}`) }],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, verificationStatus: "verified" as const, warnings: [] },
    },
  } satisfies SecAnalysisArtifact;
  const published: Array<{ artifact: SecAnalysisArtifact; summary: unknown }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    published.push(JSON.parse(String(init?.body)) as { artifact: SecAnalysisArtifact; summary: unknown });
    return Response.json({ status: "ok" });
  };

  await createSecPipelineOperations(env, fetcher).publish(artifact, null);

  assert.equal(published.length, 6);
  assert.deepEqual(published.flatMap((body) => body.artifact.blocks.map((block) => block.blockId)), citedBlocks.map((block) => block.blockId));
  assert.ok(published.slice(0, -1).every((body) => body.artifact.report.dataQuality.verificationStatus === "failed"));
  assert.equal(published.at(-1)?.artifact.report.dataQuality.verificationStatus, "verified");
  assert.ok(published.every((body) => body.artifact.blocks.length <= 5));
});

test("publishes event summaries without creating a structured filing artifact", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
  } as SecPipelineEnv;
  const summary = {
    ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event",
    headline: "事件简析", bullets: [{ label: "事件", detail: "影响已披露。", importance: "high" as const }],
    analystView: "事件改变短期预期。", source: "deepseek" as const, generatedAt: "2026-08-10T00:00:00.000Z",
  };

  await createSecPipelineOperations(env, async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ status: "published" });
  }).publishEvent(summary);

  assert.deepEqual(requestBody?.filing, { ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event" });
  assert.equal("artifact" in (requestBody ?? {}), false);
});
