import assert from "node:assert/strict";
import test, { mock, afterEach } from "node:test";
afterEach(() => mock.restoreAll());

import { handleSecAnalysisRequest, runSecRefresh, type SecCronEnv } from "../workers/pipeline/src/core.ts";

function binding(started: Array<{ ticker: string; backfill?: boolean }>) {
  return { async create(options: { params: { ticker: string; backfill?: boolean }; id: string }) { started.push(options.params); return { id: options.id }; } };
}

function env(started: Array<{ ticker: string; backfill?: boolean }>): SecCronEnv {
  return { DB: {} as D1Database, SEC_TRACKED_TICKERS: "MSFT", SEC_REFRESH_KEY: "secret", SEC_ANALYSIS_WORKFLOW: binding(started) };
}

test("Cron normalizes Pipeline policy and never calls Web", async () => {
  mock.method(globalThis, "fetch", async () => { throw new Error("Web is offline"); });
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  assert.deepEqual(await runSecRefresh({ ...env(started), SEC_TRACKED_TICKERS: " msft,MSFT,NVDA " }), { started: ["MSFT", "NVDA"], failed: [] });
});
test("an empty whitelist schedules no company", async () => {
  assert.deepEqual(await runSecRefresh({ ...env([]), SEC_TRACKED_TICKERS: "" }), { started: [], failed: [] });
});
test("invalid Pipeline policy fails before starting work", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  await assert.rejects(() => runSecRefresh({ ...env(started), SEC_TRACKED_TICKERS: "MSFT,not valid,NVDA" }), /invalid ticker/i);
  assert.deepEqual(started, []);
});

test("manual refresh and backfill reject non-whitelisted tickers", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const base = env(started);
  const headers = { "x-sec-refresh-key": "secret" };

  assert.equal((await handleSecAnalysisRequest(new Request("https://pipeline.example/jobs/NVDA", { method: "POST", headers }), base, Date.now())).status, 403);
  const response = await handleSecAnalysisRequest(new Request("https://pipeline.example/backfill/MSFT", { method: "POST", headers }), base, Date.now());

  assert.equal(response.status, 202);
  assert.deepEqual(started, [{ ticker: "MSFT", requestedBy: "manual", backfill: true }]);
});

test("a manual job runs while Web is offline", async () => {
  mock.method(globalThis, "fetch", async () => { throw new Error("Web is offline"); });
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const response = await handleSecAnalysisRequest(
    new Request("https://pipeline.example/jobs/MSFT", { method: "POST", headers: { "x-sec-refresh-key": "secret" } }),
    env(started),
    Date.now(),
  );

  assert.equal(response.status, 202);
  assert.equal(started.length, 1);
});
