import assert from "node:assert/strict";
import test from "node:test";

import { D1CompanyAnalysisRepository } from "../lib/company-analysis/repository.ts";
import { D1SecRepository } from "../lib/sec-d1.ts";
import { COMPANY_ANALYSIS_SCHEMA_VERSION } from "../lib/company-analysis/contracts.ts";
import { getPublicFiling } from "../lib/sec-public-api.ts";
import { createAnalysisDatabase } from "./helpers/analysis-backend.ts";
import {
  FIXTURE_TICKER,
  VERIFIED_ACCESSION,
  VERIFIED_PERIOD_ID,
  overviewFixture,
  seedAnalysisFixtures,
  verifiedReport,
} from "./helpers/analysis-fixtures.ts";
import type { SqliteD1Database } from "./helpers/sqlite-d1.ts";

/**
 * A11. The existing publication mechanism was audited before anything was changed, and it holds up:
 * SEC reports commit through `D1.batch`, company analyses through a single guarded statement.
 * These tests pin that behaviour rather than replacing it with a new framework — the fix this
 * refactor needed was in the *read* path (a storage failure used to be swallowed), not the write.
 */

function publication(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    analysisId: "company:MSFT:analysis-1",
    ticker: FIXTURE_TICKER,
    triggerRef: "memory-job-1:3",
    periodId: `${FIXTURE_TICKER}:2026-06-30:quarterly`,
    periodEnd: "2026-06-30",
    reportLabel: "FY2026 Q4",
    inputHash: "input-hash-0001",
    memoryVersion: 3,
    fundamentalsDataVersion: "fundamentals-hash-0001",
    status: "ready",
    coverageStatus: "complete",
    overview: overviewFixture(),
    modelVersion: "test-model.v1",
    promptVersion: "company-analysis-skill.v2",
    generatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a published company analysis is immutable — a different body under the same id is refused", async () => {
  const database = await createAnalysisDatabase();
  const repository = new D1CompanyAnalysisRepository(database);
  const first = await repository.publish(publication());
  assert.equal(first.duplicate, false);

  const replay = await repository.publish(publication());
  assert.equal(replay.duplicate, true, "an identical replay is a no-op, not a rewrite");

  await assert.rejects(
    repository.publish(publication({ inputHash: "input-hash-9999" })),
    /immutable/,
  );
  const stored = await repository.getLatestPublication(FIXTURE_TICKER);
  assert.equal(stored?.inputHash, "input-hash-0001");
  database.close();
});

/** A11: an older run finishing later must not displace a newer published revision. */
test("an older run cannot overwrite a newer published company analysis", async () => {
  const database = await createAnalysisDatabase();
  const repository = new D1CompanyAnalysisRepository(database);

  await repository.publish(publication({
    analysisId: "company:MSFT:newer",
    inputHash: "input-hash-newer",
    triggerRef: "memory-job-2:4",
    generatedAt: "2026-08-01T00:00:00.000Z",
    overview: { ...overviewFixture(), headline: "Newer revision" },
  }));
  // The straggler: started earlier, commits later, carries older content.
  await repository.publish(publication({
    analysisId: "company:MSFT:older",
    inputHash: "input-hash-older",
    triggerRef: "memory-job-1:3",
    generatedAt: "2026-07-01T00:00:00.000Z",
    overview: { ...overviewFixture(), headline: "Older revision" },
  }));

  const latest = await repository.getLatestPublication(FIXTURE_TICKER);
  assert.equal(latest?.overview.headline, "Newer revision");
  assert.equal(latest?.inputHash, "input-hash-newer");
  database.close();
});

test("a company-analysis publication is one statement, so a reader cannot see it half-written", async () => {
  const database = await createAnalysisDatabase();
  const statements: string[] = [];
  const recording = {
    prepare(sql: string) {
      if (/INSERT|UPDATE|DELETE/i.test(sql)) statements.push(sql);
      return database.prepare(sql);
    },
    batch: database.batch.bind(database),
  };
  await new D1CompanyAnalysisRepository(recording).publish(publication());
  assert.equal(statements.length, 1, "a multi-statement publication could be observed part-way through");
  assert.match(statements[0]!, /INSERT INTO company_analysis_runs/);
  database.close();
});

test("a SEC report and its summary commit together or not at all", async () => {
  const database = await createAnalysisDatabase();
  let batched = 0;
  const failing = {
    prepare: database.prepare.bind(database),
    async batch(statements: Parameters<SqliteD1Database["batch"]>[0]) {
      batched = statements.length;
      throw new Error("D1 batch failed mid-publication");
    },
  };
  const artifact = {
    filing: { ticker: FIXTURE_TICKER, accessionNumber: "0000000001-26-000009" },
    periodId: `${FIXTURE_TICKER}:2026-09-30:quarter`,
    report: verifiedReport(),
    artifactKeys: { synthesis: "r2/key/synthesis" },
  };
  const summary = {
    ticker: FIXTURE_TICKER,
    accessionNumber: "0000000001-26-000009",
    generatedAt: "2026-10-01T00:00:00.000Z",
  };
  await assert.rejects(
    new D1SecRepository(failing).commitFinalPublication(artifact as never, summary as never),
    /batch failed/,
  );
  assert.equal(batched, 3, "report, summary and memory job travel in one batch");

  // Nothing was written, so nothing partial is readable.
  const rows = database.raw.prepare("SELECT COUNT(*) AS count FROM sec_published_reports").get() as { count: number };
  assert.equal(rows.count, 0);
  database.close();
});

test("a failed analysis is never published, and a stored failed report is never read back", async () => {
  const database = await createAnalysisDatabase();
  const repository = new D1SecRepository(database);
  const failed = { ...verifiedReport(), dataQuality: { coverage: 0, verificationStatus: "failed", warnings: [] } };
  await assert.rejects(
    repository.commitFinalPublication(
      { filing: { ticker: FIXTURE_TICKER, accessionNumber: "x" }, periodId: "p", report: failed, artifactKeys: { synthesis: "k" } } as never,
      { ticker: FIXTURE_TICKER, accessionNumber: "x" } as never,
    ),
    /Failed SEC analysis cannot be published/,
  );

  // Even if one were on file from before that guard existed, the query filters it out.
  database.raw.prepare(`
    INSERT INTO sec_published_reports (ticker, period_id, report_version, payload, verification_status)
    VALUES (?, ?, 'v-failed', ?, 'failed')
  `).run(FIXTURE_TICKER, "legacy-period", JSON.stringify(failed));
  assert.equal(await repository.getPublishedReport(FIXTURE_TICKER, "legacy-period"), null);
  database.close();
});

/** A10: a run that fails afterwards leaves the report exactly as it was, at the same revision. */
test("a failed later run leaves the previously published filing report untouched", async () => {
  const database = await createAnalysisDatabase();
  await seedAnalysisFixtures(database);
  const repository = new D1SecRepository(database);
  const before = await getPublicFiling(repository, FIXTURE_TICKER, VERIFIED_ACCESSION);

  await repository.upsertAnalysisJob({
    jobId: `${VERIFIED_ACCESSION}:retry`,
    ticker: FIXTURE_TICKER,
    accessionNumber: VERIFIED_ACCESSION,
    analysisVersion: "sec-analysis.v2",
    status: "failed",
    currentStage: "synthesis",
    attempt: 2,
    errorCode: "MODEL_TIMEOUT",
    requestedBy: "scheduled",
    workflowInstanceId: "wf-retry",
    updatedAt: "2026-08-15T00:00:00.000Z",
  });

  const after = await getPublicFiling(repository, FIXTURE_TICKER, VERIFIED_ACCESSION);
  assert.deepEqual(after!.filing.analysis, before!.filing.analysis);
  assert.equal(after!.filing.contentRevision, before!.filing.contentRevision);
  assert.equal(after!.filing.analysisStatus, "complete", "the published report stays readable");
  assert.equal(after!.filing.analysisRun.state, "failed", "and the failure is visible beside it");
  assert.equal(after!.filing.analysisRun.errorCode, "MODEL_TIMEOUT");
  database.close();
});

/** The narrow read-path fix: a storage failure used to be swallowed and served as "no report". */
test("a storage failure while reading a report propagates instead of becoming an empty result", async () => {
  const database = await createAnalysisDatabase();
  await seedAnalysisFixtures(database);
  const broken = {
    prepare(sql: string) {
      if (sql.includes("sec_published_reports")) throw new Error("D1_ERROR: connection lost");
      return database.prepare(sql);
    },
    batch: database.batch.bind(database),
  };
  await assert.rejects(
    getPublicFiling(new D1SecRepository(broken), FIXTURE_TICKER, VERIFIED_ACCESSION),
    /connection lost/,
  );
  // The healthy path still returns the report, so the change did not just break the query.
  const healthy = await getPublicFiling(new D1SecRepository(database), FIXTURE_TICKER, VERIFIED_ACCESSION);
  assert.equal(healthy?.filing.analysis?.periodId, VERIFIED_PERIOD_ID);
  database.close();
});
