import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSecAnalysisRequest,
  runSecRefresh,
  type SecCronEnv,
  type SecWorkflowBinding,
} from "../workers/sec-cron/core.ts";

const env: SecCronEnv = {
  WEB_APP_ORIGIN: "https://web.example",
  SEC_REFRESH_KEY: "refresh-key",
  SEC_ANALYSIS_WORKFLOW: workflowBinding(),
};

/** The whitelist is served by the Web Worker, so every entry point here has to go and read it. */
const watchlist: typeof fetch = async () => Response.json({ tickers: ["MSFT", "NOK"] });

function workflowBinding(started: string[] = []): SecWorkflowBinding {
  return {
    async create(options) {
      started.push(options.params.ticker);
      return { id: options.id };
    },
  };
}

test("loads the watchlist and starts one independent workflow per ticker", async () => {
  const started: string[] = [];
  const result = await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) }, watchlist, 1_786_000_000_000);

  assert.deepEqual(result, { started: ["MSFT", "NOK"], failed: [] });
  assert.deepEqual(started, ["MSFT", "NOK"]);
});

test("continues starting remaining workflows after one failure", async () => {
  const started: string[] = [];
  const binding: SecWorkflowBinding = {
    async create(options) {
      if (options.params.ticker === "MSFT") throw new Error("workflow unavailable");
      started.push(options.params.ticker);
      return { id: options.id };
    },
  };
  assert.deepEqual(await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, watchlist, 1_786_000_000_000), { started: ["NOK"], failed: ["MSFT"] });
  assert.deepEqual(started, ["NOK"]);
});

test("accepts authenticated manual jobs without running analysis in the request", async () => {
  const started: string[] = [];
  const response = await handleSecAnalysisRequest(
    new Request("https://worker.example/jobs/MSFT", { method: "POST", headers: { "x-sec-refresh-key": "refresh-key" } }),
    { ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) },
    1_786_000_000_000,
    watchlist,
  );

  assert.equal(response.status, 202);
  assert.deepEqual(started, ["MSFT"]);
  assert.equal((await response.json() as { status: string }).status, "queued");
  assert.equal((await handleSecAnalysisRequest(new Request("https://worker.example/jobs/MSFT", { method: "POST" }), env, 1_786_000_000_000, watchlist)).status, 401);
});

test("creates a distinct workflow for each manual force refresh", async () => {
  const ids: string[] = [];
  const binding: SecWorkflowBinding = {
    async create(options) {
      ids.push(options.id);
      return { id: options.id };
    },
  };
  const request = () => new Request("https://worker.example/jobs/MSFT", {
    method: "POST",
    headers: { "x-sec-refresh-key": "refresh-key" },
  });

  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000, watchlist);
  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000, watchlist);

  assert.equal(new Set(ids).size, 2);
});
