import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeYahooFundamentals,
  type NormalizedFundamentalsSnapshot,
} from "../lib/fundamental-normalization.ts";
import {
  D1FundamentalsRepository,
  FundamentalSyncInProgressError,
  FundamentalSyncLeaseLostError,
  type FundamentalSyncRunClaim,
} from "../lib/fundamentals-d1.ts";
import { parseYahooFundamentalsPayload } from "../lib/yahoo-fundamentals-schema.ts";
import {
  applyFundamentalsMigrations,
  applySqlMigration,
  SqliteD1Database,
} from "./helpers/sqlite-d1.ts";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
)) as unknown;

function runClaim(runId: string, startedAt: string, leaseUntil: string): FundamentalSyncRunClaim {
  return {
    runId,
    ticker: "ACME",
    requestHash: `request-${runId}`,
    parserVersion: "parser.v1",
    catalogVersion: "catalog.v1",
    leaseOwner: `owner-${runId}`,
    leaseUntil,
    startedAt,
  };
}

function changedRevenueSnapshot(
  source: NormalizedFundamentalsSnapshot,
  valueDecimal: string,
): NormalizedFundamentalsSnapshot {
  return {
    ...source,
    periods: source.periods.map((period) => ({ ...period })),
    observations: source.observations.map((observation) =>
      observation.metricKey === "total_revenue" && observation.periodEnd === "2026-03-31"
        ? { ...observation, valueDecimal }
        : { ...observation }),
  };
}

test("migrates existing P1 rows into the leased run schema without breaking references", async () => {
  const database = new SqliteD1Database();
  database.raw.exec("PRAGMA foreign_keys = ON");

  try {
    await applySqlMigration(database, "../../workers/pipeline/migrations/0007_yahoo_fundamentals_p1.sql");
    database.raw.prepare(`
      INSERT INTO fundamental_fetch_runs (
        run_id, ticker, status, request_hash, payload_hash, parser_version,
        catalog_version, started_at, fetched_at, completed_at
      ) VALUES (?, ?, 'success', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-run", "ACME", "request", "payload", "parser.v1", "catalog.v1",
      "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:01.000Z", "2026-08-27T00:00:02.000Z",
    );
    database.raw.prepare(`
      INSERT INTO fundamental_periods (period_id, ticker, period_type, period_end, currency)
      VALUES ('legacy-period', 'ACME', '3M', '2026-03-31', 'USD')
    `).run();
    database.raw.prepare(`
      INSERT INTO fundamental_observations (
        observation_id, period_id, ticker, period_end, metric_key, source_field,
        value_decimal, unit_family, unit, currency, basis, source_run_id
      ) VALUES (
        'legacy-observation', 'legacy-period', 'ACME', '2026-03-31',
        'total_revenue', 'quarterlyTotalRevenue', '1400000000',
        'currency', 'USD', 'USD', 'reported', 'legacy-run'
      )
    `).run();

    await applySqlMigration(database, "../../workers/pipeline/migrations/0008_yahoo_fundamentals_sync.sql");
    database.raw.exec("PRAGMA foreign_keys = ON");

    const migrated = database.raw.prepare(`
      SELECT status, quality_status AS qualityStatus, issue_count AS issueCount,
        lease_owner AS leaseOwner
      FROM fundamental_fetch_runs WHERE run_id = 'legacy-run'
    `).get() as { status: string; qualityStatus: string; issueCount: number; leaseOwner: string | null };
    assert.equal(migrated.status, "success");
    assert.equal(migrated.qualityStatus, "partial");
    assert.equal(migrated.issueCount, 0);
    assert.equal(migrated.leaseOwner, null);
    assert.equal(database.raw.prepare(
      "SELECT COUNT(*) AS count FROM fundamental_observations WHERE source_run_id = 'legacy-run'",
    ).get()?.count, 1);
    assert.deepEqual(database.raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("enforces one active ticker lease and allows a stale lease takeover", async () => {
  const database = new SqliteD1Database();
  await applyFundamentalsMigrations(database);
  const repository = new D1FundamentalsRepository(database);
  const first = runClaim("run-1", "2026-08-28T00:00:00.000Z", "2026-08-28T00:05:00.000Z");

  try {
    await repository.claimRun(first);
    await assert.rejects(
      repository.claimRun(runClaim("run-2", "2026-08-28T00:01:00.000Z", "2026-08-28T00:06:00.000Z")),
      FundamentalSyncInProgressError,
    );

    database.raw.prepare("UPDATE fundamental_fetch_runs SET lease_until = ? WHERE run_id = ?")
      .run("2026-08-28T00:01:30.000Z", first.runId);
    await repository.claimRun(
      runClaim("run-3", "2026-08-28T00:02:00.000Z", "2026-08-28T00:07:00.000Z"),
    );

    const firstStatus = database.raw.prepare(
      "SELECT status, error_code AS errorCode FROM fundamental_fetch_runs WHERE run_id = ?",
    ).get(first.runId) as { status: string; errorCode: string };
    assert.equal(firstStatus.status, "failed");
    assert.equal(firstStatus.errorCode, "LEASE_EXPIRED");
  } finally {
    database.close();
  }
});

test("fences every write when the lease expires after the preflight check", async () => {
  const database = new SqliteD1Database();
  await applyFundamentalsMigrations(database);
  const repository = new D1FundamentalsRepository(database);
  const snapshot = normalizeYahooFundamentals(parseYahooFundamentalsPayload(fixture, "ACME"));
  const claim = runClaim("run-fenced", "2026-08-28T00:00:00.000Z", "2026-08-28T00:05:00.000Z");

  try {
    await repository.claimRun(claim);
    const originalBatch = database.batch.bind(database);
    database.batch = async (statements) => {
      database.raw.prepare("UPDATE fundamental_fetch_runs SET lease_until = ? WHERE run_id = ?")
        .run("2026-08-28T00:00:01.000Z", claim.runId);
      return originalBatch(statements);
    };

    await assert.rejects(repository.commitSuccessfulRun({
      runId: claim.runId,
      leaseOwner: claim.leaseOwner,
      payloadHash: "payload-fenced",
      fetchedAt: "2026-08-28T00:00:02.000Z",
      completedAt: "2026-08-28T00:00:03.000Z",
      snapshot,
    }), FundamentalSyncLeaseLostError);
    assert.equal(database.raw.prepare(
      "SELECT COUNT(*) AS count FROM fundamental_observations",
    ).get()?.count, 0);
  } finally {
    database.close();
  }
});

test("writes revisions atomically and keeps the last good snapshot after a rejected batch", async () => {
  const database = new SqliteD1Database();
  await applyFundamentalsMigrations(database);
  const repository = new D1FundamentalsRepository(database);
  const original = normalizeYahooFundamentals(parseYahooFundamentalsPayload(fixture, "ACME"));

  try {
    const first = runClaim("run-1", "2026-08-28T00:00:00.000Z", "2026-08-28T00:05:00.000Z");
    await repository.claimRun(first);
    assert.deepEqual(await repository.commitSuccessfulRun({
      runId: first.runId,
      leaseOwner: first.leaseOwner,
      payloadHash: "payload-1",
      fetchedAt: "2026-08-28T00:00:10.000Z",
      completedAt: "2026-08-28T00:00:11.000Z",
      snapshot: original,
    }), { inserted: 10, confirmed: 0, revised: 0 });

    const second = runClaim("run-2", "2026-08-28T01:00:00.000Z", "2026-08-28T01:05:00.000Z");
    await repository.claimRun(second);
    const secondSnapshot = changedRevenueSnapshot(original, "1500000000");
    assert.deepEqual(await repository.commitSuccessfulRun({
      runId: second.runId,
      leaseOwner: second.leaseOwner,
      payloadHash: "payload-2",
      fetchedAt: "2026-08-28T01:00:10.000Z",
      completedAt: "2026-08-28T01:00:11.000Z",
      snapshot: secondSnapshot,
    }), { inserted: 0, confirmed: 9, revised: 1 });

    const latestAfterSecond = await repository.getLastGoodSnapshot("ACME");
    assert.equal(latestAfterSecond?.runId, "run-2");
    assert.equal(
      latestAfterSecond?.observations.find((item) =>
        item.metricKey === "total_revenue" && item.periodEnd === "2026-03-31")?.valueDecimal,
      "1500000000",
    );
    assert.equal(database.raw.prepare(
      "SELECT COUNT(*) AS count FROM fundamental_observation_revisions",
    ).get()?.count, 1);

    const third = runClaim("run-3", "2026-08-28T02:00:00.000Z", "2026-08-28T02:05:00.000Z");
    await repository.claimRun(third);
    const rejectedSnapshot = {
      ...changedRevenueSnapshot(secondSnapshot, "1600000000"),
      qualityStatus: "invalid",
    } as unknown as NormalizedFundamentalsSnapshot;
    await assert.rejects(repository.commitSuccessfulRun({
      runId: third.runId,
      leaseOwner: third.leaseOwner,
      payloadHash: "payload-3",
      fetchedAt: "2026-08-28T02:00:10.000Z",
      completedAt: "2026-08-28T02:00:11.000Z",
      snapshot: rejectedSnapshot,
    }));
    await repository.failRun(
      third.runId,
      third.leaseOwner,
      "TEST_REJECTED",
      "Rejected by the test quality gate.",
      "2026-08-28T02:00:12.000Z",
    );

    const latestAfterFailure = await repository.getLastGoodSnapshot("ACME");
    assert.equal(latestAfterFailure?.runId, "run-2");
    assert.equal(
      latestAfterFailure?.observations.find((item) =>
        item.metricKey === "total_revenue" && item.periodEnd === "2026-03-31")?.valueDecimal,
      "1500000000",
    );
    assert.equal(database.raw.prepare(
      "SELECT COUNT(*) AS count FROM fundamental_observation_revisions",
    ).get()?.count, 1);
  } finally {
    database.close();
  }
});
