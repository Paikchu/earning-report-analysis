import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FUNDAMENTALS_API_SCHEMA_VERSION,
  FUNDAMENTALS_STALE_AFTER_MS,
  getPublicFundamentals,
  parseFundamentalApiQuery,
} from "../lib/fundamentals-api.ts";
import { AnalysisRequestError } from "../lib/analysis-contract/errors.ts";
import { FUNDAMENTAL_METRIC_CATALOG_VERSION } from "../lib/fundamental-metrics.ts";
import { normalizeYahooFundamentals } from "../lib/fundamental-normalization.ts";
import type {
  FundamentalLastGoodSnapshot,
  FundamentalsRepository,
} from "../lib/fundamentals-d1.ts";
import { parseYahooFundamentalsPayload } from "../lib/yahoo-fundamentals-schema.ts";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
)) as unknown;
const normalized = normalizeYahooFundamentals(parseYahooFundamentalsPayload(fixture, "ACME"));

function lastGoodSnapshot(overrides: Partial<FundamentalLastGoodSnapshot> = {}): FundamentalLastGoodSnapshot {
  return {
    ticker: "ACME",
    runId: "run-1",
    fetchedAt: "2026-08-28T00:00:00.000Z",
    qualityStatus: normalized.qualityStatus,
    parserVersion: normalized.parserVersion,
    catalogVersion: normalized.catalogVersion,
    payloadHash: "payload-1",
    issueCount: normalized.issueCount,
    observations: normalized.observations.map((observation) => ({
      ...observation,
      sourceRunId: "run-1",
      revision: 1,
      updatedAt: "2026-08-28T00:00:01.000Z",
    })),
    ...overrides,
  };
}

function readRepository(snapshot: FundamentalLastGoodSnapshot | null) {
  return {
    async getLastGoodSnapshot() { return snapshot; },
  } satisfies Pick<FundamentalsRepository, "getLastGoodSnapshot">;
}

test("returns a stable filtered series contract without Yahoo source fields", async () => {
  const query = parseFundamentalApiQuery(
    "acme",
    new URLSearchParams("metrics=total_revenue,gross_margin&periodCount=2"),
  );
  const response = await getPublicFundamentals(
    readRepository(lastGoodSnapshot()),
    query,
    new Date("2026-08-28T01:00:00.000Z"),
  );

  assert.equal(response.schemaVersion, FUNDAMENTALS_API_SCHEMA_VERSION);
  assert.equal(response.catalogVersion, FUNDAMENTAL_METRIC_CATALOG_VERSION);
  assert.equal(response.status, "ready");
  assert.equal(response.stale, false);
  assert.equal(response.partial, true);
  assert.match(response.dataVersion ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(response.periods.map((period) => period.periodEnd), ["2025-12-31", "2026-03-31"]);
  assert.deepEqual(response.series.map((series) => series.metricKey), ["total_revenue", "gross_margin"]);
  assert.deepEqual(response.series[0]?.points.map((point) => point.valueDecimal), ["1250000000", "1400000000"]);
  assert.deepEqual(response.series[1]?.points.map((point) => point.valueDecimal), ["34", "32"]);

  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /sourceField|quarterlyTotalRevenue|payloadHash|sourceRunId/);
});

test("returns all available catalog metrics by default and represents missing points as null", async () => {
  const snapshot = lastGoodSnapshot({
    observations: lastGoodSnapshot().observations.filter((observation) =>
      observation.metricKey !== "gross_margin" || observation.periodEnd !== "2026-03-31"),
  });
  const response = await getPublicFundamentals(
    readRepository(snapshot),
    parseFundamentalApiQuery("ACME", new URLSearchParams("periodCount=2")),
    new Date("2026-08-28T01:00:00.000Z"),
  );

  assert.deepEqual(response.series.map((series) => series.metricKey), [
    "total_revenue",
    "gross_profit",
    "diluted_eps",
    "capital_expenditure",
    "gross_margin",
  ]);
  const grossMargin = response.series.find((series) => series.metricKey === "gross_margin");
  assert.equal(grossMargin?.available, true);
  assert.deepEqual(grossMargin?.points.map((point) => point.valueDecimal), ["34", null]);
});

test("keeps dataVersion stable across identical confirmations and changes it when a value changes", async () => {
  const first = lastGoodSnapshot();
  const confirmed = lastGoodSnapshot({
    runId: "run-2",
    fetchedAt: "2026-08-29T00:00:00.000Z",
    payloadHash: "payload-2",
    observations: first.observations.map((observation) => ({
      ...observation,
      sourceRunId: "run-2",
      updatedAt: "2026-08-29T00:00:01.000Z",
    })),
  });
  const changed = lastGoodSnapshot({
    observations: first.observations.map((observation) =>
      observation.metricKey === "total_revenue" && observation.periodEnd === "2026-03-31"
        ? { ...observation, valueDecimal: "1500000000", revision: 2 }
        : observation),
  });
  const query = parseFundamentalApiQuery("ACME", new URLSearchParams());

  const [firstResponse, confirmedResponse, changedResponse] = await Promise.all([
    getPublicFundamentals(readRepository(first), query),
    getPublicFundamentals(readRepository(confirmed), query),
    getPublicFundamentals(readRepository(changed), query),
  ]);
  assert.equal(firstResponse.dataVersion, confirmedResponse.dataVersion);
  assert.notEqual(firstResponse.dataVersion, changedResponse.dataVersion);
});

test("marks old or catalog-outdated snapshots stale and recommends refresh", async () => {
  const fetchedAt = new Date("2026-08-28T00:00:00.000Z");
  const old = await getPublicFundamentals(
    readRepository(lastGoodSnapshot({ fetchedAt: fetchedAt.toISOString() })),
    parseFundamentalApiQuery("ACME", new URLSearchParams()),
    new Date(fetchedAt.getTime() + FUNDAMENTALS_STALE_AFTER_MS),
  );
  const outdatedCatalog = await getPublicFundamentals(
    readRepository(lastGoodSnapshot({ catalogVersion: "catalog.old" })),
    parseFundamentalApiQuery("ACME", new URLSearchParams()),
    new Date("2026-08-28T01:00:00.000Z"),
  );

  assert.equal(old.stale, true);
  assert.equal(old.refresh.recommended, true);
  assert.equal(outdatedCatalog.stale, true);
});

test("returns a pending contract when D1 has no last-good snapshot", async () => {
  const response = await getPublicFundamentals(
    readRepository(null),
    parseFundamentalApiQuery("ACME", new URLSearchParams()),
  );

  assert.equal(response.status, "pending");
  assert.equal(response.dataVersion, null);
  assert.equal(response.stale, true);
  assert.deepEqual(response.periods, []);
  assert.deepEqual(response.series, []);
  assert.equal(response.refresh.recommended, true);
});

test("rejects malformed tickers, metric lists, repeated parameters, and period bounds", () => {
  assert.throws(
    () => parseFundamentalApiQuery("AC/ME", new URLSearchParams()),
    (error: unknown) => error instanceof AnalysisRequestError && error.code === "INVALID_TICKER",
  );
  for (const query of [
    "metrics=unknown_metric",
    "metrics=total_revenue,,gross_margin",
    "metrics=total_revenue&metrics=gross_margin",
  ]) {
    assert.throws(
      () => parseFundamentalApiQuery("ACME", new URLSearchParams(query)),
      (error: unknown) => error instanceof AnalysisRequestError && error.code === "INVALID_METRICS",
    );
  }
  for (const query of ["periodCount=1", "periodCount=13", "periodCount=5.5", "periodCount=5&periodCount=6"]) {
    assert.throws(
      () => parseFundamentalApiQuery("ACME", new URLSearchParams(query)),
      (error: unknown) => error instanceof AnalysisRequestError && error.code === "INVALID_PERIOD_COUNT",
    );
  }
});
