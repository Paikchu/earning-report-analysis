import assert from "node:assert/strict";
import test from "node:test";

import type { SecAnalysisContext } from "../lib/sec-service.ts";
import type { SecFiling } from "../lib/sec.ts";
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
    DEEPSEEK_API_KEY: "worker-model-secret",
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

test("calls DeepSeek from the workflow worker when its model secret is configured", async () => {
  const objects = new Map<string, string>();
  const requests: string[] = [];
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    DEEPSEEK_API_KEY: "worker-model-secret",
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
    if (url === "https://api.deepseek.com/chat/completions") {
      const full = JSON.parse(objects.get("filings/MSFT/annual.json") ?? "{}") as { blocks?: Array<{ blockId: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{ moduleKey: "performance", blockIds: [full.blocks?.[0]?.blockId], confidence: 1 }] }) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const context: SecAnalysisContext = { currentPeriodId: "MSFT:2026-06-30:annual", qoqPeriodId: null, yoyPeriodId: null, qoq: {}, yoy: {}, activeMemory: [] };
  const reference = await operations.prepare(filing);

  await operations.route(filing, reference, context);

  assert.ok(requests.includes("https://api.deepseek.com/chat/completions"));
  assert.equal(requests.some((url) => url.includes("/api/internal/sec/model")), false);
});
