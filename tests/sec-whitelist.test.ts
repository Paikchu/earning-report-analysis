import assert from "node:assert/strict";
import test from "node:test";

import { handleSecAnalysisRequest, runSecRefresh, type SecCronEnv } from "../workers/sec-cron/core.ts";

function binding(started: Array<{ ticker: string; backfill?: boolean }>) {
  return { async create(options: { params: { ticker: string; backfill?: boolean }; id: string }) { started.push(options.params); return { id: options.id }; } };
}

function env(started: Array<{ ticker: string; backfill?: boolean }>, tracked = "MSFT,NVDA"): SecCronEnv {
  return { WEB_APP_ORIGIN: "https://web.example", SEC_REFRESH_KEY: "secret", SEC_TRACKED_TICKERS: tracked, SEC_ANALYSIS_WORKFLOW: binding(started) };
}

test("Cron reads only the normalized environment whitelist", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  assert.deepEqual(await runSecRefresh(env(started, " msft, MSFT\nNVDA ")), { started: ["MSFT", "NVDA"], failed: [] });
  assert.deepEqual(started, [{ ticker: "MSFT", requestedBy: "scheduled", backfill: false }, { ticker: "NVDA", requestedBy: "scheduled", backfill: false }]);
});

test("an empty whitelist schedules no company", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  assert.deepEqual(await runSecRefresh(env(started, "")), { started: [], failed: [] });
  assert.deepEqual(started, []);
});

test("one invalid whitelist entry fails the whole scheduled task", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  await assert.rejects(() => runSecRefresh(env(started, "MSFT,not valid,NVDA")), /invalid ticker/i);
  assert.deepEqual(started, []);
});

test("manual refresh and backfill reject non-whitelisted tickers", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const base = env(started, "MSFT");
  const headers = { "x-sec-refresh-key": "secret" };
  assert.equal((await handleSecAnalysisRequest(new Request("https://pipeline.example/jobs/NVDA", { method: "POST", headers }), base)).status, 403);
  const response = await handleSecAnalysisRequest(new Request("https://pipeline.example/backfill/MSFT", { method: "POST", headers }), base);
  assert.equal(response.status, 202);
  assert.deepEqual(started, [{ ticker: "MSFT", requestedBy: "manual", backfill: true }]);
});
