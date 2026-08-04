import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePreparedSecModule,
  discoverSecTicker,
  prepareSecFiling,
  routePreparedSecFiling,
  selectWorkflowFilings,
  summarizePreparedSecFiling,
  type SecModelCall,
} from "../lib/sec-pipeline.ts";
import { SEC_ANALYSIS_MODULES } from "../lib/sec-analysis.ts";
import type { SecAnalysisContext } from "../lib/sec-service.ts";
import type { SecFiling } from "../lib/sec.ts";

const filing: SecFiling = {
  ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
  filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "annual", primaryDocument: "msft.htm",
  description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
};

test("selects only the newest primary filing and never publishes a supporting filing as its own period", () => {
  const filings: SecFiling[] = [
    filing,
    { ...filing, form: "8-K", accessionNumber: "support", primaryDocument: "support.htm" },
    { ...filing, form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-04-29", accessionNumber: "older", primaryDocument: "older.htm" },
  ];

  assert.deepEqual(selectWorkflowFilings(filings).map((item) => item.accessionNumber), ["annual"]);
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

test("runs routing, module extraction and summary as separate operations", async () => {
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
      keyMetrics: [{ metricKey: "revenue", currentValue: "120", evidenceIds: [`ev:${prepared.blocks[0].blockId}`] }],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, warnings: [] },
    };
  };

  const router = await routePreparedSecFiling(prepared, context, model);
  const modules = await Promise.all(SEC_ANALYSIS_MODULES.map((module) => analyzePreparedSecModule(module.key, prepared, context, router, model)));
  const result = await summarizePreparedSecFiling(prepared, context, router, modules, model, new Date("2026-08-05T00:00:00.000Z"));

  assert.equal(modules.every((module) => module.verificationStatus === "verified"), true);
  assert.equal(result.artifact.report.dataQuality.verificationStatus, "partial");
  assert.deepEqual(calls, ["router", ...SEC_ANALYSIS_MODULES.map((module) => `module:${module.key}`), "summary"]);
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
      keyMetrics: [],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
    }),
  );

  assert.equal(result.artifact.report.dataQuality.coverage, 0);
  assert.equal(result.artifact.report.dataQuality.verificationStatus, "failed");
});
