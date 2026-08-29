import assert from "node:assert/strict";
import test from "node:test";

import { handleSecAnalysisRequest, runSecRefresh, type SecCronEnv } from "../workers/pipeline/core.ts";

function binding(started: Array<{ ticker: string; backfill?: boolean }>) {
  return { async create(options: { params: { ticker: string; backfill?: boolean }; id: string }) { started.push(options.params); return { id: options.id }; } };
}

function env(started: Array<{ ticker: string; backfill?: boolean }>): SecCronEnv {
  return { WEB_APP_ORIGIN: "https://web.example", SEC_REFRESH_KEY: "secret", SEC_ANALYSIS_WORKFLOW: binding(started) };
}

/** The Web Worker owns the whitelist; this stands in for `/api/internal/sec/watchlist`. */
function watchlist(tickers: string[], requests: string[] = []): typeof fetch {
  return async (input, init) => {
    requests.push(String(input));
    assert.equal((init?.headers as Record<string, string>)?.["x-sec-refresh-key"], "secret");
    return Response.json({ tickers });
  };
}

test("Cron reads the whitelist from the Web Worker and normalizes it", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const requests: string[] = [];

  assert.deepEqual(await runSecRefresh(env(started), watchlist([" msft", "MSFT", "NVDA "], requests)), { started: ["MSFT", "NVDA"], failed: [] });

  assert.deepEqual(requests, ["https://web.example/api/internal/sec/watchlist"]);
  assert.deepEqual(started, [{ ticker: "MSFT", requestedBy: "scheduled", backfill: false }, { ticker: "NVDA", requestedBy: "scheduled", backfill: false }]);
});

test("an empty whitelist schedules no company", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  assert.deepEqual(await runSecRefresh(env(started), watchlist([])), { started: [], failed: [] });
  assert.deepEqual(started, []);
});

test("one invalid whitelist entry fails the whole scheduled task", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  await assert.rejects(() => runSecRefresh(env(started), watchlist(["MSFT", "not valid", "NVDA"])), /invalid ticker/i);
  assert.deepEqual(started, []);
});

test("an unreachable watchlist stops the round instead of falling back to a stale list", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const down: typeof fetch = async () => new Response("upstream down", { status: 503 });

  await assert.rejects(() => runSecRefresh(env(started), down), /SEC watchlist HTTP 503/);
  assert.deepEqual(started, []);
});

test("manual refresh and backfill reject non-whitelisted tickers", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const base = env(started);
  const headers = { "x-sec-refresh-key": "secret" };
  const only = watchlist(["MSFT"]);

  assert.equal((await handleSecAnalysisRequest(new Request("https://pipeline.example/jobs/NVDA", { method: "POST", headers }), base, Date.now(), only)).status, 403);
  const response = await handleSecAnalysisRequest(new Request("https://pipeline.example/backfill/MSFT", { method: "POST", headers }), base, Date.now(), only);

  assert.equal(response.status, 202);
  assert.deepEqual(started, [{ ticker: "MSFT", requestedBy: "manual", backfill: true }]);
});

test("a manual job answers 503 when the whitelist cannot be read", async () => {
  const started: Array<{ ticker: string; backfill?: boolean }> = [];
  const down: typeof fetch = async () => new Response("upstream down", { status: 500 });
  const response = await handleSecAnalysisRequest(
    new Request("https://pipeline.example/jobs/MSFT", { method: "POST", headers: { "x-sec-refresh-key": "secret" } }),
    env(started),
    Date.now(),
    down,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(started, []);
});
