import assert from "node:assert/strict";
import test from "node:test";

import { FUNDAMENTALS_STALE_AFTER_MS } from "../lib/analysis-contract/fundamentals.ts";
import { runFundamentalsStalenessSweep } from "../workers/pipeline/fundamentals-sweep.ts";
import { D1FundamentalsRepository } from "../lib/fundamentals-d1.ts";
import { createAnalysisDatabase } from "./helpers/analysis-backend.ts";
import { seedFundamentals } from "./helpers/analysis-fixtures.ts";
import type { SqliteD1Database } from "./helpers/sqlite-d1.ts";

/**
 * The scheduled replacement for refresh-on-read. What matters is that it preserves the eligibility
 * the old path effectively had — tracked tickers only — and that it is bounded, because it now runs
 * on every Cron tick rather than being paced by page loads.
 */
const NOW = Date.parse("2026-09-05T00:00:00.000Z");

function env(database: SqliteD1Database, trackedTickers: string) {
  return { DB: database as unknown as D1Database, SEC_TRACKED_TICKERS: trackedTickers } as never;
}

test("freshness is read for the whole watchlist in one query, never-fetched included", async () => {
  const database = await createAnalysisDatabase();
  seedFundamentals(database, { ticker: "MSFT", fetchedAt: "2026-09-04T00:00:00.000Z" });
  const freshness = await new D1FundamentalsRepository(database).listFundamentalsFreshness(["MSFT", "NVDA"]);
  assert.deepEqual(freshness, [
    { ticker: "MSFT", fetchedAt: "2026-09-04T00:00:00.000Z" },
    // Present with a null rather than omitted: never fetched is exactly what the sweep is for.
    { ticker: "NVDA", fetchedAt: null },
  ]);
  database.close();
});

test("only stale or never-fetched tracked tickers are swept, oldest first", async () => {
  const database = await createAnalysisDatabase();
  seedFundamentals(database, { ticker: "MSFT", fetchedAt: new Date(NOW - 1_000).toISOString() });
  seedFundamentals(database, { ticker: "AMZN", fetchedAt: new Date(NOW - FUNDAMENTALS_STALE_AFTER_MS * 3).toISOString() });
  seedFundamentals(database, { ticker: "AAPL", fetchedAt: new Date(NOW - FUNDAMENTALS_STALE_AFTER_MS * 2).toISOString() });

  const synced: string[] = [];
  const result = await runFundamentalsStalenessSweep(env(database, "MSFT,AMZN,AAPL,NVDA"), {
    now: NOW,
    maxPerRun: 10,
    sync: async (ticker) => { synced.push(ticker); },
  });

  // NVDA has never been fetched and sorts first; then the oldest snapshots. MSFT is fresh.
  assert.deepEqual(synced, ["NVDA", "AMZN", "AAPL"]);
  assert.equal(result.candidates, 3);
  assert.deepEqual(result.failed, []);
  assert.equal(synced.includes("MSFT"), false);
  database.close();
});

test("the sweep is bounded per run, so a large backlog cannot become a large bill", async () => {
  const database = await createAnalysisDatabase();
  const synced: string[] = [];
  const result = await runFundamentalsStalenessSweep(env(database, "MSFT,AMZN,AAPL,NVDA,GOOG"), {
    now: NOW,
    maxPerRun: 2,
    sync: async (ticker) => { synced.push(ticker); },
  });
  assert.equal(synced.length, 2);
  assert.equal(result.candidates, 5, "the backlog is reported in full even though only two ran");
  database.close();
});

test("an untracked ticker is never swept, however stale — reading one cannot enlist it", async () => {
  const database = await createAnalysisDatabase();
  seedFundamentals(database, { ticker: "AMZN", fetchedAt: "2020-01-01T00:00:00.000Z" });
  const synced: string[] = [];
  await runFundamentalsStalenessSweep(env(database, "MSFT"), {
    now: NOW,
    sync: async (ticker) => { synced.push(ticker); },
  });
  assert.equal(synced.includes("AMZN"), false);
  database.close();
});

test("an empty watchlist is a no-op that touches no storage", async () => {
  const exploding = { prepare() { throw new Error("must not query"); }, batch() { throw new Error("must not query"); } };
  const result = await runFundamentalsStalenessSweep(
    { DB: exploding as unknown as D1Database, SEC_TRACKED_TICKERS: "" } as never,
    { now: NOW, sync: async () => { throw new Error("must not sync"); } },
  );
  assert.deepEqual(result, { candidates: 0, synced: [], failed: [], skipped: true });
});

test("one ticker's failure does not stop the rest of the sweep", async () => {
  const database = await createAnalysisDatabase();
  const result = await runFundamentalsStalenessSweep(env(database, "MSFT,AMZN"), {
    now: NOW,
    maxPerRun: 5,
    sync: async (ticker) => { if (ticker === "AMZN") throw new Error("Yahoo rate limited"); },
  });
  assert.deepEqual(result.synced, ["MSFT"]);
  assert.deepEqual(result.failed, ["AMZN"]);
  database.close();
});

test("a deployment with no database says so rather than sweeping nothing quietly", async () => {
  await assert.rejects(
    runFundamentalsStalenessSweep({ SEC_TRACKED_TICKERS: "MSFT" } as never, { now: NOW }),
    /D1 binding is not configured/,
  );
});
