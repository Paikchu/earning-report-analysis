import assert from "node:assert/strict";
import test from "node:test";

import { scheduleFundamentalRefresh } from "../lib/fundamentals-runtime.ts";
import { FundamentalSyncInProgressError } from "../lib/fundamentals-d1.ts";

test("hands background refresh work to waitUntil without blocking the response path", async () => {
  const calls: string[] = [];
  let backgroundTask: Promise<unknown> | null = null;
  const scheduled = await scheduleFundamentalRefresh({} as never, "ACME", {
    waitUntil: (promise) => { backgroundTask = promise; },
    syncTicker: async (ticker) => { calls.push(ticker); },
  });

  assert.equal(scheduled, true);
  assert.deepEqual(calls, ["ACME"]);
  assert.ok(backgroundTask);
  await backgroundTask;
});

test("treats a ticker lease collision as an already-scheduled refresh", async () => {
  let backgroundTask: Promise<unknown> | null = null;
  const scheduled = await scheduleFundamentalRefresh({} as never, "ACME", {
    waitUntil: (promise) => { backgroundTask = promise; },
    syncTicker: async () => { throw new FundamentalSyncInProgressError("ACME"); },
  });

  assert.equal(scheduled, true);
  assert.ok(backgroundTask);
  await backgroundTask;
});

test("reports scheduling unavailable when waitUntil cannot accept the task", async () => {
  const scheduled = await scheduleFundamentalRefresh({} as never, "ACME", {
    waitUntil: () => { throw new Error("context closed"); },
    syncTicker: async () => undefined,
  });

  assert.equal(scheduled, false);
});
