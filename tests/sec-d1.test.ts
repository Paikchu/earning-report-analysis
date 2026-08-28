import assert from "node:assert/strict";
import test from "node:test";

import { D1SecRepository, type SecAnalysisJobUpdate } from "../lib/sec-d1.ts";

/** Each test mocks only the statement methods its own call path touches, so the doubles are
 *  deliberately narrower than the repository's database parameter. */
type DatabaseMock = ConstructorParameters<typeof D1SecRepository>[0];
const asDatabase = (mock: unknown) => mock as DatabaseMock;
import type { SecFilingSummary } from "../lib/sec.ts";
import type { SecAnalysisArtifact } from "../lib/sec-types.ts";

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
  const repository = new D1SecRepository(asDatabase(database));

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
  const repository = new D1SecRepository(asDatabase(database));

  await repository.setSummary(summary);
  assert.equal((await repository.getSummary("MSFT", summary.accessionNumber))?.headline, "云业务推动增长");
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

  await new D1SecRepository(asDatabase(database)).upsertAnalysisJob(update);

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

  const status = await new D1SecRepository(asDatabase(database)).getAnalysisJobStatus("MSFT", "acc-1", "sec-analysis.v2");

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
    comparisons: [],
    report: {
      ticker: "MSFT", periodId: "MSFT:2026-06-30:annual", reportVersion: "v1", headline: "failed", keyMetrics: [],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 0, verificationStatus: "failed", warnings: ["failed"] },
    },
  } satisfies SecAnalysisArtifact;

  await new D1SecRepository(asDatabase(database)).saveAnalysis(artifact);

  assert.equal(sql.some((statement) => /INSERT INTO sec_published_reports/.test(statement)), false);
});

test("replaces a reparsed filing block by its filing ordinal", async () => {
  let blockStatement = "";
  let batched = 0;
  const database = {
    prepare(sql: string) {
      if (/INSERT INTO sec_filing_blocks/.test(sql)) blockStatement = sql;
      return {
        bind() {
          return {
            async run() { return {}; },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      batched += 1;
      return statements.map(() => ({}));
    },
  };
  const filing = {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
    filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "acc-1", primaryDocument: "msft.htm",
    description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
  };

  await new D1SecRepository(asDatabase(database)).saveFilingBlocks(filing, [{
    blockId: "acc-1:block:0001:new-hash", ordinal: 0, heading: "Item 8", headingPath: "Item 8 / block 1",
    elementType: "text", preview: "Revenue", body: "Revenue was 331839.", tokenCount: 5,
    numericDensity: 10, tableCount: 0, contentHash: "new-hash", start: 0, end: 19,
  }]);

  assert.match(blockStatement, /ON CONFLICT\(filing_id, ordinal\)/);
  assert.match(blockStatement, /block_id = excluded\.block_id/);
  assert.equal(batched, 1, "evidence writes go out as one D1 batch, not one round-trip per block");
});

test("stores same-series XBRL observations under distinct reporting-period dimensions", async () => {
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
  const observation = (endDate: string, value: string) => ({
    observationId: `xbrl:revenue:${endDate}`,
    seriesId: "revenue" as const,
    metricKey: "revenue",
    value,
    unit: "USD",
    currency: "USD",
    basis: "gaap" as const,
    periodScope: "annual" as const,
    startDate: `${endDate.slice(0, 4)}-07-01`,
    endDate,
    sourceAccession: "acc-1",
    sourceFiledAt: "2026-07-30",
    sourceVersion: "sec-canonical-series.v1",
    qualityStatus: "validated_xbrl" as const,
    xbrlConcept: "us-gaap:Revenues",
  });

  await new D1SecRepository(asDatabase(database)).saveHistory(filing, {
    registryVersion: "sec-canonical-series.v1",
    series: [{
      seriesId: "revenue",
      quarters: [],
      annual: [observation("2026-06-30", "331839"), observation("2025-06-30", "281724")],
    }],
  });

  assert.equal(factWrites.length, 2);
  assert.notEqual(factWrites[0][5], factWrites[1][5]);
  assert.deepEqual(factWrites.map((values) => JSON.parse(String(values[6])).endDate), ["2026-06-30", "2025-06-30"]);
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

  await new D1SecRepository(asDatabase(database)).getPublishedReport("MSFT", "MSFT:2026-06-30:annual");

  assert.match(selectedSql, /verification_status IN \('verified', 'partial'\)/);
});
