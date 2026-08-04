import assert from "node:assert/strict";
import test from "node:test";

import { D1SecRepository, listHoldingPlanTickers, type SecAnalysisJobUpdate } from "../lib/sec-d1.ts";
import type { SecFilingSummary } from "../lib/sec.ts";
import type { SecAnalysisArtifact } from "../lib/sec-service.ts";

test("reads and upserts SEC cache records through prepared D1 statements", async () => {
  const calls: Array<{ sql: string; values: unknown[]; action: string }> = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              calls.push({ sql, values, action: "first" });
              return { payload: JSON.stringify({ ticker: "MSFT" }), fetchedAt: "2026-07-25T00:00:00.000Z" } as T;
            },
            async run() {
              calls.push({ sql, values, action: "run" });
              return {};
            },
          };
        },
      };
    },
  };
  const repository = new D1SecRepository(database);

  const cached = await repository.getCache<{ ticker: string }>("sec:filings:MSFT");
  await repository.setCache("sec:filings:MSFT", { ticker: "MSFT" }, "2026-07-25T00:00:00.000Z");

  assert.equal(cached?.payload.ticker, "MSFT");
  assert.match(calls[0].sql, /FROM sec_cache/);
  assert.match(calls[1].sql, /ON CONFLICT\(cache_key\)/);
});

test("persists and restores one summary per ticker and accession", async () => {
  const summary: SecFilingSummary = {
    ticker: "MSFT",
    form: "10-Q",
    filingDate: "2026-07-24",
    accessionNumber: "0000789019-26-000001",
    headline: "云业务推动增长",
    bullets: [],
    analystView: "盈利质量稳定。",
    source: "deepseek",
    generatedAt: "2026-07-25T00:00:00.000Z",
  };
  let storedPayload = "";
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              return storedPayload ? { payload: storedPayload } as T : null;
            },
            async run() {
              assert.match(sql, /ON CONFLICT\(ticker, accession_number\)/);
              storedPayload = String(values[3]);
              return {};
            },
          };
        },
      };
    },
  };
  const repository = new D1SecRepository(database);

  await repository.setSummary(summary);
  assert.equal((await repository.getSummary("MSFT", summary.accessionNumber))?.headline, "云业务推动增长");
});

test("returns distinct plan tickers for the background watchlist", async () => {
  const database = {
    prepare(sql: string) {
      assert.match(sql, /SELECT DISTINCT ticker FROM holding_plans/);
      return {
        bind() {
          return {
            async all<T>() {
              return { results: [{ ticker: "MSFT" }, { ticker: "NVDA" }] as T[] };
            },
          };
        },
      };
    },
  };

  assert.deepEqual(await listHoldingPlanTickers(database), ["MSFT", "NVDA"]);
});

test("upserts independent SEC workflow job state", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              calls.push({ sql, values });
              return {};
            },
          };
        },
      };
    },
  };
  const update: SecAnalysisJobUpdate = {
    jobId: "MSFT:acc-1:sec-analysis.v2",
    ticker: "MSFT",
    accessionNumber: "acc-1",
    analysisVersion: "sec-analysis.v2",
    status: "running",
    currentStage: "router",
    attempt: 1,
    requestedBy: "scheduled",
    workflowInstanceId: "workflow-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };

  await new D1SecRepository(database).upsertAnalysisJob(update);

  assert.match(calls[0].sql, /INSERT INTO sec_analysis_jobs/);
  assert.match(calls[0].sql, /ON CONFLICT\(job_id\)/);
  assert.deepEqual(calls[0].values.slice(0, 6), [update.jobId, "MSFT", "acc-1", "sec-analysis.v2", "running", "router"]);
});

test("reads the latest status for an analysis version", async () => {
  let selectedSql = "";
  let selectedValues: unknown[] = [];
  const database = {
    prepare(sql: string) {
      selectedSql = sql;
      return {
        bind(...values: unknown[]) {
          selectedValues = values;
          return {
            async first<T>() { return { status: "complete" } as T; },
          };
        },
      };
    },
  };

  const status = await new D1SecRepository(database).getAnalysisJobStatus("MSFT", "acc-1", "sec-analysis.v2");

  assert.equal(status, "complete");
  assert.match(selectedSql, /FROM sec_analysis_jobs/);
  assert.deepEqual(selectedValues, ["MSFT", "acc-1", "sec-analysis.v2"]);
});

test("does not publish an analysis artifact that failed verification", async () => {
  const sql: string[] = [];
  const database = {
    prepare(statement: string) {
      sql.push(statement);
      return {
        bind() {
          return {
            async run() { return {}; },
            async all<T>() { return { results: [] as T[] }; },
            async first<T>() { return null as T | null; },
          };
        },
      };
    },
  };
  const filing = {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
    filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "acc-1", primaryDocument: "msft.htm",
    description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
  };
  const artifact = {
    filing,
    periodId: "MSFT:2026-06-30:annual",
    periodScope: "annual",
    blocks: [],
    moduleAnalyses: [],
    snapshots: [],
    comparisons: [],
    memoryCandidates: [],
    router: { selections: [], source: "fallback", status: "failed", missingModules: [] },
    report: {
      ticker: "MSFT", periodId: "MSFT:2026-06-30:annual", reportVersion: "v1", headline: "failed", keyMetrics: [],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 0, verificationStatus: "failed", warnings: ["failed"] },
    },
  } satisfies SecAnalysisArtifact;

  await new D1SecRepository(database).saveAnalysis(artifact);

  assert.equal(sql.some((statement) => /INSERT INTO sec_published_reports/.test(statement)), false);
});

test("stores same-metric filing facts under distinct reporting-period dimensions", async () => {
  const factWrites: unknown[][] = [];
  const factStatements: string[] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (/INSERT INTO sec_facts/.test(sql)) {
                factWrites.push(values);
                factStatements.push(sql);
              }
              return {};
            },
          };
        },
      };
    },
  };
  const filing = {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
    filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "acc-1", primaryDocument: "msft.htm",
    description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
  };
  const factBase = {
    metricKey: "revenue", unit: "USD millions", currency: "USD", basis: "gaap" as const,
    evidenceIds: ["ev:block-1"], confidence: "high" as const, sourceLabel: "fact_source_reported" as const,
  };
  const snapshot = {
    ticker: "MSFT", periodId: "MSFT:2026-06-30:annual", filingId: "acc-1", moduleKey: "performance" as const,
    facts: [
      { ...factBase, value: "331839", periodScope: "FY2026" },
      { ...factBase, value: "281724", periodScope: "FY2025" },
    ],
    claims: [], memoryCandidates: [], missingFields: [], evidenceCoverage: 1, verificationStatus: "verified" as const,
  };
  const artifact = {
    filing, periodId: snapshot.periodId, periodScope: "annual" as const, blocks: [],
    moduleAnalyses: [snapshot], snapshots: [snapshot], comparisons: [], memoryCandidates: [],
    router: { selections: [], source: "fallback" as const, status: "failed" as const, missingModules: [] },
    report: {
      ticker: "MSFT", periodId: snapshot.periodId, reportVersion: "v1", headline: "", keyMetrics: [],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 0, verificationStatus: "failed" as const, warnings: [] },
    },
  } satisfies SecAnalysisArtifact;

  await new D1SecRepository(database).saveAnalysis(artifact);

  assert.equal(factWrites.length, 2);
  assert.notEqual(factWrites[0][5], factWrites[1][5]);
  assert.deepEqual(factWrites.map((values) => JSON.parse(String(values[6])).periodScope), ["FY2026", "FY2025"]);
  assert.ok(factStatements.every((sql) => /ON CONFLICT\(period_id, series_id, dimensions_hash, basis\)/.test(sql)));
});

test("never reads a previously stored failed report as the published report", async () => {
  let selectedSql = "";
  const database = {
    prepare(sql: string) {
      selectedSql = sql;
      return {
        bind() {
          return {
            async first<T>() { return null as T | null; },
          };
        },
      };
    },
  };

  await new D1SecRepository(database).getPublishedReport("MSFT", "MSFT:2026-06-30:annual");

  assert.match(selectedSql, /verification_status IN \('verified', 'partial'\)/);
});
