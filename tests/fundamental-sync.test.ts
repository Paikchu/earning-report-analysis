import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FundamentalSyncService,
  type FundamentalSyncServiceOptions,
} from "../lib/fundamental-sync.ts";
import type {
  FundamentalLastGoodSnapshot,
  FundamentalSyncCommit,
  FundamentalSyncRunClaim,
  FundamentalsRepository,
} from "../lib/fundamentals-d1.ts";
import {
  YahooFundamentalsRequestError,
  type YahooFundamentalsFetchResult,
  type YahooFundamentalsRequest,
} from "../lib/yahoo-fundamentals-client.ts";
import { parseYahooFundamentalsPayload } from "../lib/yahoo-fundamentals-schema.ts";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
)) as unknown;

class RecordingRepository implements FundamentalsRepository {
  claims: FundamentalSyncRunClaim[] = [];
  commits: FundamentalSyncCommit[] = [];
  failures: Array<{ runId: string; code: string; detail: string }> = [];

  async claimRun(input: FundamentalSyncRunClaim): Promise<void> {
    this.claims.push(input);
  }

  async failRun(runId: string, _leaseOwner: string, code: string, detail: string): Promise<void> {
    this.failures.push({ runId, code, detail });
  }

  async commitSuccessfulRun(input: FundamentalSyncCommit) {
    this.commits.push(input);
    return { inserted: input.snapshot.observations.length, confirmed: 0, revised: 0 };
  }

  async getLastGoodSnapshot(): Promise<FundamentalLastGoodSnapshot | null> {
    return null;
  }
}

function successfulFetch(
  parsed = parseYahooFundamentalsPayload(fixture, "ACME"),
): (request: YahooFundamentalsRequest) => Promise<YahooFundamentalsFetchResult> {
  return async (request) => ({
    request,
    parsed,
    payloadHash: "payload-hash",
    fetchedAt: "2026-08-28T00:00:01.000Z",
    attempts: 1,
  });
}

function service(
  repository: RecordingRepository,
  fetchFundamentals: NonNullable<FundamentalSyncServiceOptions["fetchFundamentals"]>,
) {
  let id = 0;
  return new FundamentalSyncService(repository, {
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    idFactory: () => `id-${++id}`,
    fetchFundamentals,
  });
}

test("orchestrates a claimed Yahoo run through normalization and one commit", async () => {
  const repository = new RecordingRepository();
  const result = await service(repository, successfulFetch()).syncTicker("acme");

  assert.equal(result.runId, "id-1");
  assert.equal(result.ticker, "ACME");
  assert.equal(result.qualityStatus, "partial");
  assert.equal(result.periodCount, 2);
  assert.equal(result.observationCount, 10);
  assert.equal(repository.claims.length, 1);
  assert.equal(repository.commits.length, 1);
  assert.deepEqual(repository.failures, []);
});

test("marks a quality-gate rejection failed without committing observations", async () => {
  const repository = new RecordingRepository();
  const parsed = parseYahooFundamentalsPayload(fixture, "ACME");
  parsed.observations = parsed.observations.filter((item) => item.periodEnd === "2026-03-31");

  await assert.rejects(
    service(repository, successfulFetch(parsed)).syncTicker("ACME"),
    /fewer than 2 usable quarters/i,
  );
  assert.equal(repository.commits.length, 0);
  assert.equal(repository.failures.length, 1);
  assert.equal(repository.failures[0]?.code, "QUALITY_INSUFFICIENT_QUARTERS");
});

test("records a bounded Yahoo failure code and does not commit", async () => {
  const repository = new RecordingRepository();
  const failure = new YahooFundamentalsRequestError({
    code: "HTTP_ERROR",
    message: "Yahoo request failed.\nDo not persist response bodies.",
    status: 429,
    retryable: true,
  });

  await assert.rejects(
    service(repository, async () => { throw failure; }).syncTicker("ACME"),
    failure,
  );
  assert.equal(repository.commits.length, 0);
  assert.deepEqual(repository.failures, [{
    runId: "id-1",
    code: "YAHOO_HTTP_ERROR",
    detail: "Yahoo request failed. Do not persist response bodies.",
  }]);
});
