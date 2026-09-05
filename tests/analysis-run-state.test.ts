import assert from "node:assert/strict";
import test from "node:test";

import { ANALYSIS_API_SCHEMAS, validateJsonSchema } from "../lib/analysis-contract/index.ts";
import { handleAnalysisReadRequest } from "../workers/pipeline/read-api/router.ts";
import { D1CompanyAnalysisRepository } from "../lib/company-analysis/repository.ts";
import { getPublicCompanyAnalysis } from "../lib/company-analysis/api.ts";
import type { PublicCompanyAnalysisResponse } from "../lib/company-analysis/contracts.ts";
import { createAnalysisDatabase, readEnv, readRequest } from "./helpers/analysis-backend.ts";
import {
  FIXTURE_TICKER,
  seedCompanyAnalysisPublication,
  seedCompanyAnalysisRun,
} from "./helpers/analysis-fixtures.ts";
import type { SqliteD1Database } from "./helpers/sqlite-d1.ts";

/**
 * The six situations §4.4 requires the contract to keep apart. Each one is built in a real database
 * and read through the real handler, then checked on both axes at once: what is published, and what
 * the latest execution is doing. Getting either axis alone right is not enough — the whole point is
 * that they are independent.
 */
async function read(database: SqliteD1Database): Promise<PublicCompanyAnalysisResponse> {
  const response = await handleAnalysisReadRequest(
    readRequest(`/api/v1/companies/${FIXTURE_TICKER}/analysis`),
    readEnv(database),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as PublicCompanyAnalysisResponse;
  assert.deepEqual(validateJsonSchema(ANALYSIS_API_SCHEMAS.CompanyAnalysis, payload), []);
  return payload;
}

test("1. nothing published and no execution history at all", async () => {
  const database = await createAnalysisDatabase();
  const payload = await read(database);
  assert.equal(payload.status, "unavailable");
  assert.deepEqual(payload.latestRun, { state: "none", updatedAt: null, errorCode: null });
  assert.equal(payload.overview, null);
  assert.equal(payload.versions.contentRevision, null);
  database.close();
});

test("2. the first analysis is queued or running, with no result yet", async () => {
  for (const [status, expected] of [["waiting_fundamentals", "queued"], ["analyzing", "running"]] as const) {
    const database = await createAnalysisDatabase();
    seedCompanyAnalysisRun(database, { analysisId: `run-${status}`, status, updatedAt: "2026-09-01T00:00:00.000Z" });
    const payload = await read(database);
    assert.equal(payload.status, "unavailable", status);
    assert.equal(payload.latestRun.state, expected, status);
    assert.equal(payload.latestRun.updatedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(payload.latestRun.errorCode, null);
    database.close();
  }
});

test("3. the first analysis failed, and the failure is not reported as never-collected", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisRun(database, {
    analysisId: "run-failed",
    status: "failed",
    updatedAt: "2026-09-01T00:00:00.000Z",
    errorCode: "MODEL_UNAVAILABLE",
  });
  const payload = await read(database);
  assert.equal(payload.status, "unavailable");
  assert.deepEqual(payload.latestRun, {
    state: "failed",
    updatedAt: "2026-09-01T00:00:00.000Z",
    errorCode: "MODEL_UNAVAILABLE",
  });
  assert.notEqual(payload.latestRun.state, "none", "a known failure must never look like no history");
  database.close();
});

test("4. a published result with a newer run in flight keeps serving the published result", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisPublication(database);
  seedCompanyAnalysisRun(database, { analysisId: "run-newer", status: "validating", updatedAt: "2026-09-02T00:00:00.000Z" });
  const payload = await read(database);
  assert.equal(payload.status, "updating");
  assert.equal(payload.latestRun.state, "running");
  assert.equal(payload.overview?.headline, "Synthetic company headline");
  assert.equal(payload.versions.contentRevision, "input-hash-0001");
  database.close();
});

/** A10: a failed newer run must not take the previous published report down with it. */
test("5. a published result with a newer failed run stays ready, at its own revision", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisPublication(database);
  const before = await read(database);

  seedCompanyAnalysisRun(database, {
    analysisId: "run-newer-failed",
    status: "failed",
    updatedAt: "2026-09-02T00:00:00.000Z",
    errorCode: "VALIDATION_REJECTED",
  });
  const after = await read(database);

  assert.equal(after.status, "ready");
  assert.equal(after.latestRun.state, "failed");
  assert.equal(after.latestRun.errorCode, "VALIDATION_REJECTED");
  // Same content, same revision: a failed run changes nothing about what was published.
  assert.deepEqual(after.overview, before.overview);
  assert.equal(after.versions.contentRevision, before.versions.contentRevision);
  assert.equal(after.generatedAt, before.generatedAt);
  database.close();
});

test("6. a newly published result reports ready and a succeeded run", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisPublication(database);
  const payload = await read(database);
  assert.equal(payload.status, "ready");
  assert.equal(payload.latestRun.state, "succeeded");
  assert.equal(payload.latestRun.errorCode, null);
  assert.equal(payload.overview?.highlights.length, 4);
  database.close();
});

/** Not knowing is not the same as knowing there is nothing. */
test("unreadable run history reports unknown, and does not hide a readable publication", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisPublication(database);
  const repository = new D1CompanyAnalysisRepository(database);
  const payload = await getPublicCompanyAnalysis({
    getLatestPublication: (ticker) => repository.getLatestPublication(ticker),
    hasNewerActiveRun: () => Promise.resolve(false),
    getLatestRunSummary: () => Promise.reject(new Error("run history is unavailable")),
  }, FIXTURE_TICKER);
  assert.equal(payload.status, "ready");
  assert.equal(payload.latestRun.state, "unknown");
  assert.ok(payload.overview);
  database.close();
});

test("an error code that is not a machine code is reduced rather than echoed", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisRun(database, {
    analysisId: "run-leaky",
    status: "failed",
    updatedAt: "2026-09-03T00:00:00.000Z",
    errorCode: "provider said: your api key sk-live-abc is invalid",
  });
  const payload = await read(database);
  assert.equal(payload.latestRun.errorCode, "ANALYSIS_FAILED");
  assert.doesNotMatch(JSON.stringify(payload), /sk-live-abc/);
  database.close();
});

test("insufficient_data is a terminal outcome with its own code, not a silent gap", async () => {
  const database = await createAnalysisDatabase();
  seedCompanyAnalysisRun(database, {
    analysisId: "run-insufficient",
    status: "insufficient_data",
    updatedAt: "2026-09-03T00:00:00.000Z",
  });
  const payload = await read(database);
  assert.equal(payload.latestRun.state, "failed");
  assert.equal(payload.latestRun.errorCode, "INSUFFICIENT_DATA");
  database.close();
});
