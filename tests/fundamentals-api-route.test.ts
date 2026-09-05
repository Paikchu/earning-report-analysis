import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handlePublicFundamentalsRequest } from "../lib/fundamentals-api.ts";
import { FUNDAMENTAL_METRIC_CATALOG_VERSION } from "../lib/fundamental-metrics.ts";
import type {
  FundamentalLastGoodSnapshot,
  FundamentalsRepository,
} from "../lib/fundamentals-d1.ts";

function repository(snapshot: FundamentalLastGoodSnapshot | null): FundamentalsRepository {
  return {
    async claimRun() {},
    async failRun() {},
    async commitSuccessfulRun() { return { inserted: 0, confirmed: 0, revised: 0 }; },
    async getLastGoodSnapshot() { return snapshot; },
  };
}

function minimalSnapshot(fetchedAt: string): FundamentalLastGoodSnapshot {
  return {
    ticker: "ACME",
    runId: "run-1",
    fetchedAt,
    qualityStatus: "complete",
    parserVersion: "parser.v1",
    catalogVersion: FUNDAMENTAL_METRIC_CATALOG_VERSION,
    payloadHash: "payload-1",
    issueCount: 0,
    observations: [{
      observationId: "observation-1",
      periodId: "period-1",
      ticker: "ACME",
      periodType: "3M",
      periodEnd: "2026-03-31",
      metricKey: "total_revenue",
      sourceField: "quarterlyTotalRevenue",
      valueDecimal: "1400000000",
      unitFamily: "currency",
      unit: "USD",
      currency: "USD",
      basis: "reported",
      derivationFormula: null,
      derivationVersion: null,
      sourceRunId: "run-1",
      revision: 1,
      updatedAt: fetchedAt,
    }],
  };
}

test("returns stale last-good immediately and schedules one eligible background refresh", async () => {
  const refreshes: string[] = [];
  const response = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/ACME/fundamentals?metrics=total_revenue&periodCount=2"),
    "ACME",
    {
      getRepository: async () => repository(minimalSnapshot("2026-08-26T00:00:00.000Z")),
      isRefreshEligible: () => true,
      scheduleRefresh: async (ticker) => { refreshes.push(ticker); return true; },
      clock: () => new Date("2026-08-28T00:00:00.000Z"),
    },
  );
  const payload = await response.json() as { stale: boolean; refresh: { scheduled: boolean } };

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /stale-while-revalidate/);
  assert.equal(payload.stale, true);
  assert.equal(payload.refresh.scheduled, true);
  assert.deepEqual(refreshes, ["ACME"]);
});

test("does not schedule a refresh for fresh data", async () => {
  let refreshCount = 0;
  const response = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/ACME/fundamentals"),
    "ACME",
    {
      getRepository: async () => repository(minimalSnapshot("2026-08-28T00:00:00.000Z")),
      isRefreshEligible: () => true,
      scheduleRefresh: async () => { refreshCount += 1; return true; },
      clock: () => new Date("2026-08-28T01:00:00.000Z"),
    },
  );
  const payload = await response.json() as { refresh: { scheduled: boolean } };

  assert.equal(response.status, 200);
  assert.equal(payload.refresh.scheduled, false);
  assert.equal(refreshCount, 0);
});

test("returns no-store pending data for an eligible first fetch and rejects ineligible misses", async () => {
  const eligible = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/ACME/fundamentals"),
    "ACME",
    {
      getRepository: async () => repository(null),
      isRefreshEligible: () => true,
      scheduleRefresh: async () => true,
    },
  );
  const eligiblePayload = await eligible.json() as { status: string; refresh: { scheduled: boolean } };
  assert.equal(eligible.status, 200);
  assert.equal(eligible.headers.get("cache-control"), "no-store");
  assert.equal(eligiblePayload.status, "pending");
  assert.equal(eligiblePayload.refresh.scheduled, true);

  const ineligible = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/UNKNOWN/fundamentals"),
    "UNKNOWN",
    {
      getRepository: async () => repository(null),
      isRefreshEligible: () => false,
      scheduleRefresh: async () => { throw new Error("must not schedule"); },
    },
  );
  assert.equal(ineligible.status, 404);
  assert.equal((await ineligible.json() as { code: string }).code, "FUNDAMENTALS_NOT_AVAILABLE");
});

test("maps query and database failures to bounded public errors", async () => {
  const invalid = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/ACME/fundamentals?metrics=unknown"),
    "ACME",
    {
      getRepository: async () => { throw new Error("must not query"); },
      isRefreshEligible: () => true,
      scheduleRefresh: async () => true,
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { code: string }).code, "INVALID_METRICS");

  const failed = await handlePublicFundamentalsRequest(
    new Request("https://example.test/api/v1/companies/ACME/fundamentals"),
    "ACME",
    {
      getRepository: async () => { throw new Error("D1 internal detail"); },
      isRefreshEligible: () => true,
      scheduleRefresh: async () => true,
    },
  );
  const failedBody = JSON.stringify(await failed.json());
  assert.equal(failed.status, 500);
  assert.match(failedBody, /FUNDAMENTALS_QUERY_FAILED/);
  assert.doesNotMatch(failedBody, /D1 internal detail/);
});

test("exposes the public route without importing the Yahoo adapter into the read path", async () => {
  const source = await readFile(
    new URL("../app/api/v1/companies/[ticker]/fundamentals/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /handlePublicFundamentalsRequest/);
  assert.match(source, /scheduleFundamentalRefresh/);
  assert.match(source, /findSecurity/);
  assert.doesNotMatch(source, /yahoo-fundamentals-client|fetchYahooFundamentals/);
});
