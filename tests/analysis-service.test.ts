import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createAnalysisClient } from "../lib/web/analysis-client.ts";
import { handleAnalysisApi } from "../workers/pipeline/src/read-api.ts";
import { createSecPipelineOperations, type SecPipelineEnv } from "../workers/pipeline/src/operations.ts";
import { SqliteD1Database } from "./helpers/sqlite-d1.ts";
import type { SecFilingFeed } from "../workers/pipeline/src/sec/sec.ts";

async function database() {
  const db = new SqliteD1Database();
  const directory = new URL("../workers/pipeline/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) db.raw.exec((await readFile(new URL(file, directory), "utf8")).replaceAll("--> statement-breakpoint", ""));
  return db;
}
const unavailableNetwork: typeof fetch = async () => { throw new Error("Web is unavailable"); };

test("Pipeline writes feed and event to its database and Web reads via the sole binding", async () => {
  const db = await database();
  try {
    const env: SecPipelineEnv = {
      DB: db as unknown as D1Database, SEC_TRACKED_TICKERS: "MSFT", SEC_REFRESH_KEY: "test-key", SEC_USER_AGENT: "test", SEC_FILINGS: { async get() { return null; }, async put() {} },
      SEC_ANALYSIS_WORKFLOW: { async create() { return { id: "job" }; } },
    };
    const filing = { ticker: "MSFT", cik: "789019", cikNumber: 789019, companyName: "Microsoft", form: "8-K", filingDate: "2026-09-01", reportDate: "2026-09-01", accessionNumber: "0000789019-26-000001", primaryDocument: "report.htm", description: "Event", items: "", documentUrl: "https://www.sec.gov/report.htm", indexUrl: "https://www.sec.gov/index.htm", summary: null };
    const feed: SecFilingFeed = { ticker: "MSFT", company: { ticker: "MSFT", cik: "789019", name: "Microsoft" }, filings: [filing], fetchedAt: "2026-09-07T00:00:00Z", status: "ready" };
    const operations = createSecPipelineOperations(env, unavailableNetwork);
    await operations.publishFeed(feed);
    await operations.publishEvent({ ticker: "MSFT", form: "8-K", filingDate: filing.filingDate, accessionNumber: filing.accessionNumber, headline: "Event analysis", bullets: [], analystView: "Evidence", source: "deepseek", generatedAt: "2026-09-07T00:00:00Z" });
    const client = createAnalysisClient({ token: "test-key", binding: { fetch: (request) => handleAnalysisApi(request, env) } });
    const response = await client.request("/api/v1/companies/MSFT/filings");
    assert.equal(response.status, 200);
    const body = await response.json() as { filings: Array<{ summary: { headline: string } }> };
    assert.equal(body.filings[0].summary.headline, "Event analysis");
    assert.equal((await client.request("/api/v1/companies/MSFT/filings/0000789019-26-000001")).status, 200);
    assert.equal((await client.request("/api/v1/companies/MSFT/analysis")).status, 200);
    assert.equal((await client.request("/api/v1/admin/companies/MSFT/refresh", "POST")).status, 202);
    assert.equal((await client.request("/api/v1/admin/companies/NVDA/refresh", "POST")).status, 403);
    assert.equal((await client.request("/api/v1/companies/MSFT/filings?cursor=invalid")).status, 400);
    assert.equal((await handleAnalysisApi(new Request("https://analysis.internal/api/internal/sec/publish", { method: "POST", headers: { "x-sec-refresh-key": "test-key" } }), env)).status, 404);
    assert.equal((await createAnalysisClient({ token: "wrong", binding: { fetch: (request) => handleAnalysisApi(request, env) } }).request("/api/v1/companies/MSFT/filings")).status, 401);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sec_memory_jobs").get()?.n, 0, "event publication never creates periodic memory jobs");
  } finally { db.close(); }
});

test("a failed service returns a bounded unavailable response without leaking credentials", async () => {
  const response = await createAnalysisClient({ token: "do-not-leak", binding: { async fetch() { throw new Error("do-not-leak"); } } }).request("/api/v1/companies/MSFT/analysis");
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /do-not-leak/);
  assert.equal((await createAnalysisClient({ token: "" }).request("/api/v1/companies/MSFT/analysis")).status, 503);
});

test("periodic publication and Memory claiming stay inside Pipeline with real D1", async () => {
  const { publishSecAnalysis } = await import("../workers/pipeline/src/services/sec-publish.ts");
  const { runSecMemorySweep } = await import("../workers/pipeline/src/core.ts");
  const db = await database();
  try {
    const queued: string[] = [];
    const env: SecPipelineEnv = {
      DB: db as unknown as D1Database, SEC_TRACKED_TICKERS: "MSFT", SEC_REFRESH_KEY: "key", SEC_USER_AGENT: "test",
      SEC_FILINGS: { async get() { return null; }, async put() {} },
      SEC_ANALYSIS_WORKFLOW: { async create() { return { id: "job" }; } },
      SEC_MEMORY_WORKFLOW: { async create(options) { queued.push(options.params.jobId); return { id: options.id }; } },
    };
    const filing = { ticker: "MSFT", cik: "789019", cikNumber: 789019, companyName: "Microsoft", form: "10-Q", filingDate: "2026-09-01", reportDate: "2026-06-30", accessionNumber: "0000789019-26-000002", primaryDocument: "report.htm", description: "Quarterly", items: "", documentUrl: "https://www.sec.gov/report.htm", indexUrl: "https://www.sec.gov/index.htm" };
    const periodId = "MSFT:2026-06-30:quarter";
    const result = await publishSecAnalysis({
      artifact: { filing, periodId, periodScope: "quarter", blocks: [], comparisons: [], artifactKeys: { synthesis: "analysis/MSFT/synthesis.json" }, report: { ticker: "MSFT", periodId, reportVersion: "v1", headline: "Quarterly result", keyMetrics: [], changes: { qoq: [], yoy: [], guidance: [], risks: [] }, dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] } } },
      summary: { ticker: "MSFT", form: "10-Q", filingDate: filing.filingDate, accessionNumber: filing.accessionNumber, headline: "Quarterly result", bullets: [], analystView: "Evidence", source: "deepseek", generatedAt: "2026-09-07T00:00:00Z" },
    }, env);
    assert.equal(result.status, 200);
    const publication = await result.json() as { memoryJobId: string };
    assert.ok(publication.memoryJobId);
    assert.deepEqual(await runSecMemorySweep(env), { started: [publication.memoryJobId] });
    assert.deepEqual(queued, [publication.memoryJobId]);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sec_published_reports").get()?.n, 1);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sec_filing_summaries").get()?.n, 1);
  } finally { db.close(); }
});
