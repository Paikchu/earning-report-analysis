import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleAnalysisReadRequest } from "../workers/pipeline/read-api/router.ts";
import { createAnalysisDatabase, readEnv, readRequest } from "./helpers/analysis-backend.ts";
import { ETF_TICKER, FIXTURE_TICKER, seedFundamentals } from "./helpers/analysis-fixtures.ts";
import type { PublicFundamentalsResponse } from "../lib/analysis-contract/fundamentals.ts";

/**
 * This file used to test `handlePublicFundamentalsRequest` on the Web Worker, whose defining
 * behaviour was scheduling a background refresh whenever a read found stale data. That behaviour is
 * gone — a read must not enqueue work (§4.1) — and the endpoint moved to the analysis backend, so
 * the same scenarios are covered here against their new home, with the refresh expectations
 * inverted: what used to be asserted to happen is now asserted not to.
 */
async function fundamentals(path: string, database: unknown) {
  return handleAnalysisReadRequest(readRequest(path), readEnv(database));
}

test("stale last-good data is returned immediately and schedules nothing", async () => {
  const database = await createAnalysisDatabase();
  seedFundamentals(database, { fetchedAt: "2020-01-01T00:00:00.000Z" });
  const response = await fundamentals(`/api/v1/companies/${FIXTURE_TICKER}/fundamentals?metrics=total_revenue&periodCount=2`, database);
  const payload = await response.json() as PublicFundamentalsResponse;

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ready");
  assert.equal(payload.stale, true);
  // Staleness is still reported; acting on it is the scheduled sweep's job, not a reader's.
  assert.equal(payload.refresh.recommended, true);
  assert.equal(payload.refresh.scheduled, false);
  assert.equal(payload.refresh.mode, "backend_scheduled");
  database.close();
});

test("fresh data is not stale and is briefly cacheable", async () => {
  const database = await createAnalysisDatabase();
  seedFundamentals(database, { fetchedAt: new Date().toISOString() });
  const response = await fundamentals(`/api/v1/companies/${FIXTURE_TICKER}/fundamentals`, database);
  const payload = await response.json() as PublicFundamentalsResponse;
  assert.equal(payload.stale, false);
  assert.equal(payload.refresh.recommended, false);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=30/);
  database.close();
});

test("an eligible first fetch is a no-store pending payload; an ineligible one is a 404", async () => {
  const database = await createAnalysisDatabase();
  const eligible = await fundamentals(`/api/v1/companies/${FIXTURE_TICKER}/fundamentals`, database);
  const eligiblePayload = await eligible.json() as PublicFundamentalsResponse;
  assert.equal(eligible.status, 200);
  assert.equal(eligible.headers.get("cache-control"), "no-store");
  assert.equal(eligiblePayload.status, "pending");
  assert.equal(eligiblePayload.refresh.scheduled, false);

  // An ETF has no fundamentals to collect, and says so rather than reporting an empty pending set.
  const ineligible = await fundamentals(`/api/v1/companies/${ETF_TICKER}/fundamentals`, database);
  assert.equal(ineligible.status, 404);
  assert.equal((await ineligible.json() as { code: string }).code, "FUNDAMENTALS_NOT_AVAILABLE");
  database.close();
});

test("query and storage failures map to bounded errors that leak no internal detail", async () => {
  const database = await createAnalysisDatabase();
  const invalid = await fundamentals(`/api/v1/companies/${FIXTURE_TICKER}/fundamentals?metrics=unknown`, database);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { code: string }).code, "INVALID_METRICS");

  const failed = await handleAnalysisReadRequest(
    readRequest(`/api/v1/companies/${FIXTURE_TICKER}/fundamentals`),
    readEnv({ prepare() { throw new Error("D1 internal detail"); }, batch() { throw new Error("D1 internal detail"); } }),
  );
  const failedBody = await failed.text();
  // A storage failure is 503, not the 500 the old Web handler returned, and not an empty success.
  assert.equal(failed.status, 503);
  assert.match(failedBody, /STORAGE_UNAVAILABLE/);
  assert.doesNotMatch(failedBody, /D1 internal detail/);
  database.close();
});

test("the public Web route is a proxy that neither queries a database nor schedules a refresh", async () => {
  const source = await readFile(
    new URL("../app/api/v1/companies/[ticker]/fundamentals/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /proxyAnalysisRead/);
  assert.match(source, /getFundamentals/);
  assert.doesNotMatch(source, /scheduleFundamentalRefresh|getD1|D1FundamentalsRepository/);
  assert.doesNotMatch(source, /yahoo-fundamentals-client|fetchYahooFundamentals/);
});
